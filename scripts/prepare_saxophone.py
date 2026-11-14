"""Import full licensed saxophone recordings and integrate the single collection."""
import concurrent.futures
import hashlib
import html
import json
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.request
import zipfile
import sys

ROOT = pathlib.Path.cwd()

def probe(path):
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)]))
    return float(info['format']['duration'])

def render(item):
    with tempfile.TemporaryDirectory(prefix='caro-sax-') as folder:
        folder = pathlib.Path(folder)
        source = folder / 'source'
        for attempt in range(3):
            try:
                request = urllib.request.Request(item['url'], headers={
                    'User-Agent': 'Mozilla/5.0', 'Referer': item['sourceUrl']})
                with urllib.request.urlopen(request, timeout=90) as response, source.open('wb') as out:
                    while chunk := response.read(1024 * 1024):
                        out.write(chunk)
                assert source.stat().st_size > 100000, item['title']
                break
            except Exception as error:
                print('DOWNLOAD RETRY ' + item['title'] + ': ' + str(error), flush=True)
                if attempt == 2:
                    raise RuntimeError('Download failed: ' + item['title'] + ' ' + item['url']) from error
                time.sleep(3 * (attempt + 1))
        if item.get('archiveMember'):
            with zipfile.ZipFile(source) as archive:
                content = archive.read(item['archiveMember'])
            source.write_bytes(content)
        original_duration = probe(source)
        assert 60 < original_duration < 900, (item['title'], original_duration)
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        # Two-pass loudness normalization retains dynamics and avoids clipping.
        analysis = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(source), '-af',
            'loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
            capture_output=True, text=True, check=True).stderr
        measurements = json.loads(analysis[analysis.rfind('{'):])
        audio_filter = ('loudnorm=I=-18:TP=-1.5:LRA=11:linear=true'
            ':measured_I=' + measurements['input_i'] + ':measured_TP=' + measurements['input_tp']
            + ':measured_LRA=' + measurements['input_lra'] + ':measured_thresh=' + measurements['input_thresh']
            + ':offset=' + measurements['target_offset'])
        output = ROOT / item['path']
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-map_metadata', '-1',
            '-af', audio_filter, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '256k',
            '-metadata', 'title=' + item['title'], '-metadata', 'artist=' + item['artist'], str(output)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(output), '-f', 'null', '-'], check=True)
        duration = probe(output)
        assert abs(duration - original_duration) < 0.2, item['title']
        result = dict(item, duration=duration, bytes=output.stat().st_size,
            sourceSha256=source_hash, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
            changes='Two-pass loudness normalization; original arrangement and duration preserved')
        print('VERIFIED ' + item['title'] + ' ' + str(round(duration, 1)) + 's', flush=True)
        return result

def integrate(catalog):
    page = ROOT / 'index.html'
    text = page.read_text(encoding='utf-8')
    tracks = [{'title': item['title'], 'artist': item['artist'], 'src': item['path']} for item in catalog]
    styles = {'saxophone': {'name': 'Saxophone Lounge', 'tracks': tracks}}
    text, n = re.subn(r'const musicStyles=\{.*?\};',
        'const musicStyles=' + json.dumps(styles, ensure_ascii=False, separators=(',', ':')) + ';', text, count=1)
    assert n == 1
    text = re.sub(r'^musicStyles\.water=.*?;\s*$', '', text, flags=re.M)
    text = text.replace("style:'relax'", "style:'saxophone'")
    text, n = re.subn(r'<label for="musicStyle">.*?</select>',
        '<span class="sax-collection">Saxophone Lounge · 20 bản tuyển chọn</span>', text, count=1)
    assert n == 1 or 'class="sax-collection"' in text
    text = text.replace("$('musicStyle').value=music.style;", '')
    text = re.sub(r"^\$\('musicStyle'\)\.onchange=.*?;\s*$", '', text, flags=re.M)
    assert "$('musicStyle')" not in text
    credits = '<details style="font-size:12px;color:#52617a;margin-bottom:14px"><summary>Saxophone Lounge · Tác giả &amp; giấy phép</summary>'
    credits += '<p>20 bản saxophone và hòa tấu jazz, lounge, neo-soul &amp; nu-jazz. Giữ nguyên tác phẩm; cân bằng âm lượng để nghe êm và đều.</p><ol>'
    for item in catalog:
        esc = html.escape
        credits += ('<li><a href="' + esc(item['sourceUrl'], quote=True) + '" target="_blank" rel="noopener">'
            + esc(item['title']) + '</a> — ' + esc(item['artist']) + ' · <a href="'
            + esc(item['licenseUrl'], quote=True) + '" target="_blank" rel="noopener">' + esc(item['license']) + '</a></li>')
    credits += '</ol><p>Đã chuẩn hóa âm lượng và chuyển MP3; không đổi tempo, không ghép vòng lặp để kéo dài bài.</p></details>'
    text, n = re.subn(r'<details\b.*?</details>', lambda _: credits, text, count=1, flags=re.S)
    assert n == 1
    if '.sax-collection{' not in text:
        text = text.replace('</style>', '.sax-collection{display:inline-flex;align-items:center;padding:9px 14px;border:1px solid #dfd2b0;border-radius:999px;background:#fcf7ec;color:#79612e;font-size:13px;font-weight:650;letter-spacing:.1px}</style>', 1)
    assert 'TURN_MS=15000' in text and "child('closed').set(true)" not in text
    assert 'min-width:675px' not in text
    page.write_text(text, encoding='utf-8')

if __name__ == '__main__':
    sources = json.loads((ROOT / 'scripts/saxophone-sources.json').read_text(encoding='utf-8'))
    assert len(sources) == 20 and len({t['url'] for t in sources}) == 20
    assert len({t['title'] for t in sources}) == 20
    if '--preflight' in sys.argv:
        for item in sources:
            request = urllib.request.Request(item['url'], headers={
                'User-Agent': 'Mozilla/5.0', 'Referer': item['sourceUrl']})
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    assert len(response.read(1024)) > 100
                    print('SOURCE OK ' + item['title'], flush=True)
            except Exception as error:
                raise RuntimeError('Source preflight failed: ' + item['title']) from error
    elif '--preview' in sys.argv:
        integrate(sources)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            catalog = list(pool.map(render, sources))
        assert len({t['sourceSha256'] for t in catalog}) == 20, 'Duplicate recordings'
        assert len({t['sha256'] for t in catalog}) == 20, 'Duplicate audio files'
        (ROOT / 'assets/music/saxophone/catalog.json').write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding='utf-8')
        integrate(catalog)
        print('PASS: 20 distinct complete saxophone recordings, normalized and fully decoded; single-style player integrated')

