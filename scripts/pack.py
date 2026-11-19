"""Package an import-ready Cocos Creator extension with package.json at the ZIP root."""
import json
import zipfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
target = root.parent / f'CCRecord-preview-{version}.zip'
files = ['package.json', 'dist/main.js', 'dist/window-host.js', 'dist/project-asset-installer.js', 'dist/inspector.js', 'dist/panels/default/index.js', 'assets/CCRecord.ts']
files += ['test-assets/' + p.name for p in sorted((root / 'test-assets').glob('*.ts'))]
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in files:
        if not (root/name).is_file(): raise FileNotFoundError(name)
        z.write(root/name, arcname=name)
with zipfile.ZipFile(target) as z:
    assert z.namelist() == files
    assert not any(s.endswith('.zip') for s in z.namelist())
print(target)
