# Genera finanzas-personales.html: la app completa en un solo archivo.
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/styles.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
def inline(m):
    js = (root / m.group(1)).read_text(encoding='utf-8')
    assert '</script' not in js.lower(), m.group(1)
    return '<script>\n/* ' + m.group(1) + ' */\n' + js + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
(root / 'finanzas-personales.html').write_text(html, encoding='utf-8')
print('ok', len(html) // 1024, 'KB')


# --- PWA: actualiza versión y lista de archivos del service worker ---
import hashlib
files = ['index.html', 'manifest.webmanifest', 'css/styles.css'] + sorted(str(p.relative_to(root)) for p in (root / 'js').rglob('*.js')) + sorted(str(p.relative_to(root)) for p in (root / 'icons').glob('*.png'))
digest = hashlib.sha1(b''.join((root / f).read_bytes() for f in files)).hexdigest()[:10]
assets = ['./'] + ['./' + f for f in files]
sw = (root / 'sw.js').read_text(encoding='utf-8')
sw = re.sub(r'/\* BEGIN-GENERATED \*/.*?/\* END-GENERATED \*/',
            lambda m: "/* BEGIN-GENERATED */\nconst VERSION = '" + digest + "';\nconst ASSETS = " + repr(assets).replace("'", '"') + ";\n/* END-GENERATED */", sw, flags=re.S)
(root / 'sw.js').write_text(sw, encoding='utf-8')
print('sw version', digest, len(assets), 'archivos')
