"""Package the extension only, with deterministic ZIP metadata and no account data."""
from pathlib import Path
import json, zipfile, hashlib
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'CrabVIP/manifest.json').read_text())['version']
out = root / 'artifacts'
out.mkdir(exist_ok=True)
target = out / f'CrabVIP-{version}.zip'
files = [(p, p.relative_to(root / 'CrabVIP')) for p in sorted((root / 'CrabVIP').rglob('*')) if p.is_file()]
files += [(root / 'docs' / name, Path(name)) for name in ('INSTALL-RU.md', 'VALIDATION.md')]
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p, relative in files:
        info = zipfile.ZipInfo(f'CrabVIP-{version}/{relative.as_posix()}', date_time=(2026,11,4,0,0,0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, p.read_bytes())
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert json.loads(z.read(f'CrabVIP-{version}/manifest.json'))['version'] == version
print(target)
print('SHA256', hashlib.sha256(target.read_bytes()).hexdigest())
