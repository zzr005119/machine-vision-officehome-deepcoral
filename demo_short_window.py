"""Offline inference for the frozen seed-42 Product-to-Clipart short-window demo."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import json
from pathlib import Path

from PIL import Image
import torch
from torch import nn
from torchvision import models, transforms


CHECKPOINT_SHA256 = "5298447d38220ddf8456c6115a61c6e55e4dfd68040b6cf720fdc91e2620ee57"
NUM_CLASSES, FEATURE_DIM = 65, 256
CLASS_MAP = Path(__file__).resolve().parent / "data/splits/class_to_idx.json"
EVAL_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
])


class ShortWindowModel(nn.Module):
    """Inference graph with the state keys of the frozen DeepDA TransferNet."""

    def __init__(self):
        super().__init__()
        backbone = models.resnet50(weights=None)
        backbone_dim = backbone.fc.in_features
        backbone.fc = nn.Identity()
        self.base_network = backbone
        self.bottleneck_layer = nn.Sequential(nn.Linear(backbone_dim, FEATURE_DIM), nn.ReLU())
        self.classifier_layer = nn.Linear(FEATURE_DIM, NUM_CLASSES)

    def forward(self, batch: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.bottleneck_layer(self.base_network(batch))
        return self.classifier_layer(features), features


def load_model(checkpoint: str | Path, device: str | torch.device = "cpu") -> ShortWindowModel:
    """Verify and load the exact demo checkpoint into a frozen inference model."""
    with Path(checkpoint).open("rb") as handle:
        digest = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != CHECKPOINT_SHA256:
            raise ValueError(f"Short-window demo checkpoint SHA-256 mismatch: {checkpoint}")
        handle.seek(0)
        saved = torch.load(handle, map_location="cpu", weights_only=True)

    model = ShortWindowModel()
    model.load_state_dict(saved["model_state"], strict=True)
    return model.requires_grad_(False).eval().to(device)


def preprocess_image(image: Image.Image) -> torch.Tensor:
    """Return a single normalized RGB tensor of shape (3, 224, 224)."""
    return EVAL_TRANSFORM(image.convert("RGB"))


@dataclass(frozen=True)
class PCAReference:
    mean: torch.Tensor
    components: torch.Tensor

    def project(self, features: torch.Tensor) -> torch.Tensor:
        if features.ndim != 2 or features.size(1) != FEATURE_DIM:
            raise ValueError(f"PCA expects a batch of {FEATURE_DIM}-dimensional features")
        return (features.to(device="cpu", dtype=torch.float64) - self.mean) @ self.components.T


def load_pca(path: str | Path) -> PCAReference:
    """Read a two-component reference fitted to the frozen model's training features."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("checkpoint_sha256") != CHECKPOINT_SHA256:
        raise ValueError("PCA reference checkpoint SHA-256 does not match the demo checkpoint")
    try:
        mean = torch.tensor(data["mean"], dtype=torch.float64)
        components = torch.tensor(data["components"], dtype=torch.float64)
    except (KeyError, TypeError, ValueError, RuntimeError) as exc:
        raise ValueError("Invalid PCA reference mean or components") from exc
    if (mean.shape != (FEATURE_DIM,) or components.shape != (2, FEATURE_DIM)
            or not torch.isfinite(mean).all() or not torch.isfinite(components).all()):
        raise ValueError(f"PCA reference requires a finite mean and two finite {FEATURE_DIM}-dimensional components")
    return PCAReference(mean, components)


@lru_cache(maxsize=1)
def _class_names() -> tuple[str, ...]:
    mapping = json.loads(CLASS_MAP.read_text(encoding="utf-8"))
    if (not isinstance(mapping, dict) or any(type(index) is not int for index in mapping.values())
            or sorted(mapping.values()) != list(range(NUM_CLASSES))):
        raise ValueError("Invalid OfficeHome class map")
    return tuple(sorted(mapping, key=mapping.__getitem__))


@torch.inference_mode()
def predict_image(
    model: ShortWindowModel, image: Image.Image, top_k: int = 5, pca: PCAReference | None = None,
) -> dict:
    """Return ranked labels and probabilities, with an optional fixed PCA point."""
    if type(top_k) is not int or not 1 <= top_k <= NUM_CLASSES:
        raise ValueError(f"top_k must be an integer between 1 and {NUM_CLASSES}")
    batch = preprocess_image(image).unsqueeze(0).to(next(model.parameters()).device)
    logits, features = model(batch)
    probabilities, ids = logits[0].softmax(dim=0).topk(top_k)
    names = _class_names()
    result = {
        "top_k": [
            {"class_id": index, "class_name": names[index], "probability": score}
            for index, score in zip(ids.tolist(), probabilities.tolist(), strict=True)
        ],
    }
    if pca is not None:
        result["pca"] = pca.project(features)[0].tolist()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--pca", type=Path)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()
    try:
        pca = load_pca(args.pca) if args.pca is not None else None
        model = load_model(args.checkpoint, args.device)
        with Image.open(args.image) as image:
            result = predict_image(model, image, args.top_k, pca)
        print(json.dumps(result, indent=2, allow_nan=False))
    except (OSError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
