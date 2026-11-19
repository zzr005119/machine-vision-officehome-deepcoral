"""Build the short-window demo PCA from the frozen Office-Home training split."""

import argparse
import csv
import hashlib
import json
from pathlib import Path

from PIL import Image
import torch

from demo_short_window import CHECKPOINT_SHA256, load_model, load_pca, preprocess_image


TRAIN_SHA256 = "e58ab6f200ae9144c846028f7565be1f882542f02a85a9141d95438964afff31"
MODEL_ID = "pr_cl_deepda_short_window_seed42"
DOMAINS = ("Product", "Clipart")
PER_DOMAIN = 512


def build_reference(checkpoint, manifest, data_root, output, device):
    if output.exists():
        raise FileExistsError(output)
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != TRAIN_SHA256:
        raise ValueError("Expected the frozen Office-Home training manifest")
    with manifest.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    selected = []
    for domain in DOMAINS:
        candidates = (row for row in rows if row["domain"] == domain)
        ordered = sorted(candidates, key=lambda row: (
            hashlib.sha256(f"42|{domain}|{row['sample_id']}".encode()).hexdigest(), row["sample_id"],
        ))
        if len(ordered) < PER_DOMAIN:
            raise ValueError(f"Not enough training samples for {domain}")
        selected.extend(ordered[:PER_DOMAIN])
    if len({row["sample_id"] for row in selected}) != len(selected):
        raise ValueError("Selected training samples must be distinct")

    model = load_model(checkpoint, device=device)
    parts = []
    with torch.inference_mode():
        for start in range(0, len(selected), 32):
            batch = []
            for row in selected[start : start + 32]:
                with Image.open(data_root / row["relative_path"]) as image:
                    batch.append(preprocess_image(image))
            logits, features = model(torch.stack(batch).to(device))
            if not torch.isfinite(logits).all() or not torch.isfinite(features).all():
                raise ValueError("Non-finite training inference")
            parts.append(features.cpu().double())
    values = torch.cat(parts)
    center = values.mean(dim=0)
    _, singular, bases = torch.linalg.svd(values - center, full_matrices=False)
    if singular[1] <= 0:
        raise ValueError("Could not fit two nonzero PCA components")
    components = bases[:2].clone()
    for component in components:
        if component[component.abs().argmax()] < 0:
            component.neg_()
    coordinates = (values - center) @ components.T
    variance = singular.square()
    report = {
        "schema_version": 1,
        "model_id": MODEL_ID,
        "checkpoint_sha256": CHECKPOINT_SHA256,
        "train_manifest_sha256": TRAIN_SHA256,
        "sampling": "512 per domain; ascending SHA256(42|domain|sample_id); training only",
        "feature_dim": 256,
        "mean": center.tolist(),
        "components": components.tolist(),
        "explained_variance_ratio": (variance[:2] / variance.sum()).tolist(),
        "reference_points": {
            domain: coordinates[index * PER_DOMAIN : (index + 1) * PER_DOMAIN].tolist()
            for index, domain in enumerate(DOMAINS)
        },
    }
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, allow_nan=False, separators=(",", ":"))
        handle.write("\n")
    torch.testing.assert_close(load_pca(output).project(values), coordinates, rtol=0, atol=1e-12)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("checkpoint", "manifest", "data-root", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    torch.set_num_threads(4)
    report = build_reference(args.checkpoint, args.manifest, args.data_root, args.output, args.device)
    print(json.dumps({
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "reference_counts": {domain: len(points) for domain, points in report["reference_points"].items()},
        "explained_variance_ratio": report["explained_variance_ratio"],
    }))


if __name__ == "__main__":
    main()
