"""Package source code only; excludes firmware, account state, and dependencies."""
from pathlib import Path
import hashlib, json, zipfile

root = Path(__file__).resolve().parent
out = root / 'dist'
out.mkdir(exist_ok=True)
files = [root / x for x in ['package.json', 'package-lock.json', 'README.md', 'LICENSE', '.gitignore', 'service.js', 'build-release.py', 'build-auto.py', 'runtime.json', 'update.json']]
for directory in ['app', 'test', 'auto']:
    files.extend(p for p in (root / directory).rglob('*') if p.is_file())
archive = out / 'stremio-lite-tizenbrew-3.1.1-source.zip'
manifest = []
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(files):
        name = p.relative_to(root).as_posix()
        data = p.read_bytes()
        z.writestr(name, data)
        manifest.append(dict(path=name, size=len(data), sha256=hashlib.sha256(data).hexdigest()))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(manifest)
    for item in manifest:
        assert hashlib.sha256(z.read(item['path'])).hexdigest() == item['sha256']
(out / 'manifest.json').write_text(json.dumps(dict(archive=archive.name,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),files=manifest),indent=2))
print(json.dumps(dict(archive=str(archive),files=len(files),bytes=archive.stat().st_size),indent=2))
