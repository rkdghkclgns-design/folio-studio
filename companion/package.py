"""Build the companion ZIP for one site, excluding local secrets and caches."""
from __future__ import annotations

import argparse
import ast
import ipaddress
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT.parent / "dist" / "downloads" / "folio-computer-companion.zip"
FILES = ("README.md", "folio_companion.py", "windows_desktop.py", "requirements.txt", "start-windows.cmd")


def site_origin(value: str) -> str:
    """Accept a browser HTTPS origin, never a URL with credentials or a path."""
    if not value.isascii() or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value):
        raise argparse.ArgumentTypeError("site origin must be an ASCII HTTPS origin without whitespace")
    if not value.startswith("https://") or any(c in value for c in "\\?#%"):
        raise argparse.ArgumentTypeError("site origin must use https:// without a query or fragment")
    try:
        parsed = urlsplit(value)
        hostname, port = parsed.hostname, parsed.port
    except ValueError as exc:
        raise argparse.ArgumentTypeError("site origin has an invalid hostname or port") from exc
    if not hostname or parsed.path or parsed.username is not None or parsed.password is not None:
        raise argparse.ArgumentTypeError("site origin must not contain credentials or a path")
    if ":" in hostname:
        try:
            hostname = "[" + str(ipaddress.IPv6Address(hostname)) + "]"
        except ValueError as exc:
            raise argparse.ArgumentTypeError("site origin has an invalid IPv6 hostname") from exc
    elif len(hostname) > 253 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in hostname.split(".")):
        raise argparse.ArgumentTypeError("site origin has an invalid hostname")
    elif hostname.split(".")[-1].isdigit() or re.fullmatch(r"0x[0-9a-f]+", hostname.split(".")[-1]):
        # Browsers parse numerical final labels as IPv4, including legacy forms.
        try:
            if str(ipaddress.IPv4Address(hostname)) != hostname:
                raise ValueError("non-canonical IPv4 address")
        except ValueError as exc:
            raise argparse.ArgumentTypeError("site origin has an invalid IPv4 hostname") from exc
    # Reject empty, zero, non-canonical, or otherwise ambiguous port syntax.
    canonical_port = "" if port is None else f":{port}"
    expected_authority = parsed.hostname if ":" not in parsed.hostname else f"[{parsed.hostname}]"
    if parsed.netloc.lower() != expected_authority + canonical_port or port == 0:
        raise argparse.ArgumentTypeError("site origin has an invalid port")
    return "https://" + hostname + (f":{port}" if port not in (None, 443) else "")


def absolute_output(value: str) -> Path:
    output = Path(value)
    if not output.is_absolute() or output.suffix.lower() != ".zip":
        raise argparse.ArgumentTypeError("output must be an absolute .zip path")
    return output


def configured_companion(source: bytes, origin: str | None) -> tuple[bytes, str]:
    """Change only the literal site assignment in the packaged copy."""
    text = source.decode("utf-8")
    assignments = [node for node in ast.parse(text).body
                   if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == "SITE_ORIGIN" for target in node.targets)]
    if len(assignments) != 1 or len(assignments[0].targets) != 1 or not isinstance(assignments[0].value, ast.Constant) or type(assignments[0].value.value) is not str:
        raise ValueError("companion must have exactly one literal SITE_ORIGIN assignment")
    assignment = assignments[0]
    default_origin = assignment.value.value
    if origin is None:
        return source, default_origin
    lines = text.splitlines(keepends=True)
    lines[assignment.lineno - 1:assignment.end_lineno] = [f"SITE_ORIGIN = {origin!r}\n"]
    configured = "".join(lines)
    ast.parse(configured)
    return configured.encode("utf-8"), default_origin


def build_archive(output: Path = OUTPUT, origin: str | None = None) -> Path:
    if origin is not None:
        origin = site_origin(origin)
    # Read the complete allowlist before touching an existing release artifact.
    payloads = {name: (ROOT / name).read_bytes() for name in FILES}
    payloads["folio_companion.py"], default_origin = configured_companion(payloads["folio_companion.py"], origin)
    if origin is not None:
        payloads["README.md"] = payloads["README.md"].replace(default_origin.encode("utf-8"), origin.encode("utf-8"))
    payloads["start-windows.cmd"] = payloads["start-windows.cmd"].replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    # A failed write must not replace a previously working download.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".zip", delete=False) as temporary_file:
            temporary = Path(temporary_file.name)
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            for name in FILES:
                archive.writestr("folio-computer-companion/" + name, payloads[name])
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-origin", type=site_origin, help="single HTTPS browser origin allowed by this download")
    parser.add_argument("--output", type=absolute_output, default=OUTPUT, help="absolute path for the ZIP (default: dist/downloads/folio-computer-companion.zip)")
    args = parser.parse_args()
    print(build_archive(args.output, args.site_origin))


if __name__ == "__main__":
    main()
