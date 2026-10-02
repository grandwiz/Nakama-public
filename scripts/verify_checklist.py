"""Validate the interactive checklist without changing its saved answers.

Run ``python scripts/verify_checklist.py`` for read-only validation. Add
``--roundtrip`` to save and reopen checked/unchecked test copies in tmp/pdfs.
Those copies exercise every checkbox; the delivered PDF is never modified.
Requires the same reportlab and pypdf dependencies as build_checklist.py.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, IndirectObject, NameObject

from build_checklist import PAGES, build_pdf, saved_checks


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "output" / "pdf" / "Nakama-Feature-Checklist.pdf"
EXPECTED_IDS = [item[0] for page in PAGES for _, items in page["sections"] for item in items]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ref_key(value):
    ref = value if isinstance(value, IndirectObject) else getattr(value, "indirect_reference", None)
    require(isinstance(ref, IndirectObject), "Form field/widget must be an indirect PDF object")
    return ref.idnum, ref.generation


def inherited(node, key, default=None):
    """Read an effective field value, following and checking its parent chain."""
    seen = set()
    while node is not None:
        obj = node.get_object()
        identity = ref_key(node)
        require(identity not in seen, "Cyclic /Parent chain in the form")
        seen.add(identity)
        if key in obj:
            return obj[key]
        node = obj.get("/Parent")
    return default


@dataclass
class ValidatedForm:
    reader: PdfReader
    values: dict[str, str]
    on_states: dict[str, str]


def validate(path: Path, expected_values: dict[str, str] | None = None) -> ValidatedForm:
    require(len(EXPECTED_IDS) == len(set(EXPECTED_IDS)), "Checklist IDs must be unique")
    reader = PdfReader(str(path), strict=True)
    require(len(reader.pages) == len(PAGES) + 1, "Checklist page count must match its feature data")
    acroform = reader.trailer["/Root"].get("/AcroForm")
    require(acroform is not None, "Missing interactive /AcroForm")
    roots = acroform.get_object().get("/Fields")
    require(roots is not None, "Missing canonical /AcroForm/Fields tree")

    tree = {}
    named = {}
    owners = {}

    def walk(ref, prefix="", parent=None):
        key = ref_key(ref)
        obj = ref.get_object()
        require(isinstance(obj, DictionaryObject), "Invalid form tree object")
        require(key not in tree, "Repeated or cyclic object in the canonical form tree")
        tree[key] = obj
        actual_parent = obj.get("/Parent")
        require(
            (parent is None and actual_parent is None)
            or (parent is not None and actual_parent is not None and ref_key(actual_parent) == parent),
            "Form tree and /Parent links disagree",
        )
        partial_name = str(obj.get("/T", ""))
        name = ".".join(part for part in (prefix, partial_name) if part)
        if partial_name:
            require(name not in named, f"Duplicate canonical field name: {name}")
            named[name] = ref
        owners[key] = name
        for child in obj.get("/Kids", []):
            walk(child, name, key)

    for root in roots:
        walk(root)
    require(set(named) == set(EXPECTED_IDS), "Canonical field names do not match all feature IDs")
    reported = reader.get_fields() or {}
    require(set(reported) == set(EXPECTED_IDS), "get_fields() disagrees with the canonical form tree")

    values = {}
    for name, ref in named.items():
        require(inherited(ref, "/FT") == "/Btn", f"{name}: expected a checkbox button field")
        flags = int(inherited(ref, "/Ff", 0))
        require(not flags & (1 | 16384 | 32768 | 65536), f"{name}: field is read-only, radio, or push-button")
        value = inherited(ref, "/V")
        require(isinstance(value, NameObject), f"{name}: checkbox has no named canonical value")
        require(reported[name].get("/V") == value, f"{name}: get_fields() has a stale value")
        values[name] = str(value)

    widget_refs = set()
    counts = Counter()
    on_states = {}
    page_ids = []
    for page_number, page in enumerate(reader.pages, start=1):
        bounds = page.cropbox
        ids = set()
        for annotation in page.get("/Annots", []):
            widget = annotation.get_object()
            if widget.get("/Subtype") != "/Widget":
                continue
            key = ref_key(annotation)
            require(key in tree, f"Page {page_number}: orphaned widget outside the canonical form tree")
            require(key not in widget_refs, f"Page {page_number}: widget appears on multiple pages")
            widget_refs.add(key)
            name = owners[key]
            require(name in named, f"Page {page_number}: widget has no canonical named field")
            # Membership alone is insufficient: inherited values must use the same
            # parent links as the canonical field, never a second lookalike object.
            require(inherited(annotation, "/FT") == "/Btn", f"{name}: widget type differs from its field")
            require(str(inherited(annotation, "/V")) == values[name], f"{name}: widget inherits a stale value")
            require(str(widget.get("/AS")) == values[name], f"{name}: visible appearance and saved value differ")
            if "/P" in widget:
                require(ref_key(widget["/P"]) == ref_key(page), f"{name}: incorrect page pointer")
            flags = int(widget.get("/F", 0))
            require(flags & 4 and not flags & (1 | 2 | 32 | 64 | 128 | 256 | 512), f"{name}: widget is hidden, locked, or not printable")
            rect = widget.get("/Rect", [])
            require(len(rect) == 4, f"{name}: invalid widget rectangle")
            left, bottom, right, top = map(float, rect)
            require(
                float(bounds.left) <= left < right <= float(bounds.right)
                and float(bounds.bottom) <= bottom < top <= float(bounds.top),
                f"{name}: checkbox rectangle falls outside its page",
            )
            appearance = widget.get("/AP")
            require(appearance is not None, f"{name}: missing checkbox appearances")
            normal = appearance.get_object().get("/N")
            require(normal is not None, f"{name}: missing normal appearance")
            normal = normal.get_object()
            require(isinstance(normal, DictionaryObject), f"{name}: normal appearance must contain named states")
            states = set(map(str, normal.keys()))
            require("/Off" in states and len(states) == 2, f"{name}: expected unchecked and checked appearances")
            for state, stream in normal.items():
                stream = stream.get_object()
                require(hasattr(stream, "get_data") and bool(stream.get_data()), f"{name}: empty {state} appearance")
            require(values[name] in states, f"{name}: value has no matching appearance")
            on_states[name] = next(state for state in states if state != "/Off")
            counts[name] += 1
            ids.add(name)
        page_ids.append(ids)

    require(widget_refs == {key for key, obj in tree.items() if obj.get("/Subtype") == "/Widget"}, "Canonical widgets are missing from pages")
    require(counts == Counter(EXPECTED_IDS), "Each feature must have exactly one clickable widget")
    require(not page_ids[0], "The cover must not acquire acceptance checkboxes")
    for number, spec in enumerate(PAGES, start=1):
        expected_on_page = {item[0] for _, items in spec["sections"] for item in items}
        require(page_ids[number] == expected_on_page, f"Page {number + 1}: checkboxes are attached to the wrong features")
    if expected_values is not None:
        require(values == expected_values, "Reopened form did not preserve the expected saved checkbox values")
    return ValidatedForm(reader, values, on_states)


def roundtrip(source: Path, form: ValidatedForm, scratch: Path):
    """Exercise every toggle and preservation of mixed answers during rebuilding."""
    paths = [scratch / name for name in (
        "checklist-all-checked.pdf", "checklist-all-unchecked.pdf", "checklist-rebuilt-mixed.pdf",
    )]
    require(all(path.resolve() != source.resolve() for path in paths), "Scratch output must never replace the input PDF")
    source_digest = sha256(source.read_bytes()).digest()
    scratch.mkdir(parents=True, exist_ok=True)
    current = form
    for output, wanted in zip(paths[:2], [form.on_states, {name: "/Off" for name in EXPECTED_IDS}]):
        writer = PdfWriter()
        writer.clone_document_from_reader(current.reader)
        writer.update_page_form_field_values(None, wanted, auto_regenerate=False, flatten=False)
        with output.open("wb") as stream:
            writer.write(stream)
        current = validate(output, wanted)
    mixed_values = {
        name: form.on_states[name] if index % 2 == 0 else "/Off"
        for index, name in enumerate(EXPECTED_IDS)
    }
    writer = PdfWriter()
    writer.clone_document_from_reader(form.reader)
    writer.update_page_form_field_values(None, mixed_values, auto_regenerate=False, flatten=False)
    with paths[2].open("wb") as stream:
        writer.write(stream)
    saved = saved_checks(paths[2], set(EXPECTED_IDS))
    require(saved == {name for name, value in mixed_values.items() if value != "/Off"}, "Builder cannot read saved ticks")
    build_pdf(paths[2], saved)
    validate(paths[2], mixed_values)
    require(sha256(source.read_bytes()).digest() == source_digest, "Round-trip validation changed the original PDF")
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", nargs="?", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--roundtrip", action="store_true", help="Save/reopen checked and unchecked copies, then rebuild a mixed-answer copy")
    parser.add_argument("--scratch", type=Path, default=ROOT / "tmp" / "pdfs")
    args = parser.parse_args()
    form = validate(args.pdf)
    checked = sum(value != "/Off" for value in form.values.values())
    print(f"Verified {args.pdf}: {len(PAGES)+1} pages, {len(EXPECTED_IDS)} unique interactive checkboxes, {checked} checked.")
    if args.roundtrip:
        for output in roundtrip(args.pdf, form, args.scratch):
            print(f"Verified saved toggle round trip: {output}")
        print("Original checklist unchanged.")


if __name__ == "__main__":
    main()
