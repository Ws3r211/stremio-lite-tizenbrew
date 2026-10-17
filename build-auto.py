"""Build a coherent runtime bundle and the permanent launcher. No account state is read."""
from pathlib import Path
import hashlib, json
root = Path(__file__).resolve().parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
files = ['service.js', 'app/index.html', 'app/core.js', 'app/app.js', 'app/style.css', 'app/player-icons.svg', 'app/THIRD_PARTY.txt']
bundle = dict(schema=1, version=version, files={p: (root / p).read_text(encoding='utf-8') for p in files})
text = json.dumps(bundle, ensure_ascii=True, separators=(',', ':'))
descriptor = dict(schema=1, bootstrap=1, version=version, ref='v'+version, sha256=hashlib.sha256(text.encode()).hexdigest())
(root / 'runtime.json').write_text(text, encoding='utf-8')
(root / 'update.json').write_text(json.dumps(descriptor, indent=2)+'\n', encoding='utf-8')
embedded = 'var STREMIO_BUILTIN = '+json.dumps(dict(descriptor=descriptor, text=text), ensure_ascii=True, separators=(',', ':'))+';\n'
launch = '''
if (typeof __dirname === 'undefined' || require.main === module) {
    var autoOptions = {bundled: STREMIO_BUILTIN};
    if (typeof __dirname !== 'undefined') {
        autoOptions.cacheDir = require('path').join(__dirname, '../.auto-cache');
        autoOptions.loaderHTML = require('fs').readFileSync(require('path').join(__dirname, 'loader.html'), 'utf8');
    }
    var autoController = module.exports(autoOptions);
    autoController.server.on('error', function (e) { console.error('Stremio Lite launcher: ' + e.code); });
    autoController.server.listen(17780, '127.0.0.1', function () { console.log('Stremio Lite automatic launcher ready'); });
}
'''
(root / 'auto/service.js').write_text(embedded+(root/'auto/updater.js').read_text(encoding='utf-8')+launch, encoding='utf-8')
print('Built runtime '+version+' and automatic launcher; SHA-256 '+descriptor['sha256'])
