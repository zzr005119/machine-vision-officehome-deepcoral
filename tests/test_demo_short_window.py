import hashlib
import importlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from PIL import Image
import torch


class DemoShortWindowTests(unittest.TestCase):
    def setUp(self):
        try:
            self.demo = importlib.import_module("demo_short_window")
        except ModuleNotFoundError as exc:
            if exc.name != "demo_short_window":
                raise
            self.fail("The standalone short-window demo is missing")

    def test_preprocess_uses_rgb_and_direct_resize_with_imagenet_normalization(self):
        image = Image.new("L", (91, 47), 128)
        tensor = self.demo.preprocess_image(image)
        self.assertEqual(tensor.shape, (3, 224, 224))
        self.assertEqual(tensor.dtype, torch.float32)
        expected = torch.tensor([0.07406463, 0.20518208, 0.42649278])
        torch.testing.assert_close(tensor[:, 0, 0], expected, atol=1e-6, rtol=0)
        torch.testing.assert_close(tensor[:, -1, -1], expected, atol=1e-6, rtol=0)

        wide = Image.new("RGB", (400, 100), "red")
        wide.paste("blue", (350, 0, 400, 100))
        resized = self.demo.preprocess_image(wide)
        self.assertGreater(resized[0, 112, 0], resized[2, 112, 0])
        self.assertLess(resized[0, 112, -1], resized[2, 112, -1])

    def test_checkpoint_with_wrong_digest_is_rejected(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "best.pt"
            path.write_bytes(b"not a checkpoint")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                self.demo.load_model(path)

    def test_checkpoint_with_missing_state_keys_is_rejected(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "best.pt"
            torch.save({"model_state": {}}, path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with patch.object(self.demo, "CHECKPOINT_SHA256", digest):
                with self.assertRaisesRegex(RuntimeError, "Missing key"):
                    self.demo.load_model(path)

    def test_forward_and_prediction_return_features_and_ranked_officehome_classes(self):
        previous_threads = torch.get_num_threads()
        self.addCleanup(torch.set_num_threads, previous_threads)
        torch.set_num_threads(2)
        model = self.demo.ShortWindowModel().eval()
        with torch.no_grad():
            model.classifier_layer.weight.zero_()
            model.classifier_layer.bias.copy_(torch.arange(65, dtype=torch.float32))
        image = Image.new("RGB", (80, 40), "white")
        with torch.inference_mode():
            logits, features = model(self.demo.preprocess_image(image).unsqueeze(0))
        self.assertEqual(logits.shape, (1, 65))
        self.assertEqual(features.shape, (1, 256))
        self.assertTrue(torch.isfinite(features).all())
        self.assertTrue((features >= 0).all())

        result = self.demo.predict_image(model, image, top_k=2)
        self.assertEqual([(row["class_id"], row["class_name"]) for row in result["top_k"]],
                         [(64, "Webcam"), (63, "Trash_Can")])
        self.assertAlmostEqual(result["top_k"][0]["probability"], 0.63212056, places=6)
        self.assertNotIn("pca", result)
        with self.assertRaises(ValueError):
            self.demo.predict_image(model, image, top_k=0)

    def test_pca_requires_same_checkpoint_and_finite_256_dimensional_basis(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "pca.json"
            valid = {
                "checkpoint_sha256": self.demo.CHECKPOINT_SHA256,
                "mean": [1.0] * 256,
                "components": [[1.0] + [0.0] * 255, [0.0, 1.0] + [0.0] * 254],
            }
            path.write_text(json.dumps(valid), encoding="utf-8")
            pca = self.demo.load_pca(path)
            features = torch.tensor([[4.0, 7.0] + [0.0] * 254])
            torch.testing.assert_close(pca.project(features), torch.tensor([[3.0, 6.0]], dtype=torch.float64))

            for invalid in ({"checkpoint_sha256": "f" * 64}, {"mean": [0.0] * 512},
                            {"components": [[float("nan")] * 256] * 2}):
                with self.subTest(fields=list(invalid)):
                    path.write_text(json.dumps({**valid, **invalid}), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        self.demo.load_pca(path)


if __name__ == "__main__":
    unittest.main()
