"""Stage a packaged Tizen widget so the app runs with Samsung AVPlay instead of the HTML5 player.

TizenBrew application modules load as HTTP pages without Samsung's webapis. A packaged
widget loads from file:// where $WEBAPIS resolves, so window.webapis.avplay exists.
Signing happens afterwards with the Tizen CLI: tizen package -t wgt -s <profile> -- build/wgt
"""
from pathlib import Path
import json, shutil
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
assert "APP_VERSION = '" + version + "'" in (root / 'app' / 'app.js').read_text(encoding='utf-8'), 'app.js APP_VERSION must match package.json'
out = root / 'build' / 'wgt'
if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
for name in ['index.html', 'core.js', 'app.js', 'style.css', 'player-icons.svg', 'THIRD_PARTY.txt']:
    shutil.copy2(root / 'app' / name, out / name)
shutil.copy2(root / 'LICENSE', out / 'LICENSE')

icon = Image.new('RGB', (512, 512), (113, 85, 187))
draw = ImageDraw.Draw(icon)
try:
    font = ImageFont.truetype('arialbd.ttf', 300)
except OSError:
    font = ImageFont.load_default()
box = draw.textbbox((0, 0), 'S', font=font)
draw.text(((512 - (box[2] - box[0])) / 2 - box[0], (512 - (box[3] - box[1])) / 2 - box[1]), 'S', fill=(244, 244, 251), font=font)
icon.save(out / 'icon.png')

config = '''<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets" id="https://github.com/Ws3r211/stremio-lite-tizenbrew" version="{version}" viewmodes="maximized">
    <access origin="*" subdomains="true"></access>
    <tizen:application id="SLiteTizen.StremioLite" package="SLiteTizen" required_version="3.0"/>
    <content src="index.html"/>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <icon src="icon.png"/>
    <name>Stremio Lite</name>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
    <tizen:profile name="tv-samsung"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
'''.format(version=version)
(out / 'config.xml').write_text(config, encoding='utf-8')
print('Staged widget ' + version + ' in ' + str(out))
