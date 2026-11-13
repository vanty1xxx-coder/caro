"""Attach the verified soundtrack to the existing Caro player without losing settings."""
import json
import pathlib
import re
import html as html_lib

root = pathlib.Path(__file__).resolve().parents[1]
page = root / 'index.html'
text = page.read_text(encoding='utf-8')
catalog = json.loads((root / 'assets/music/v2/catalog.json').read_text(encoding='utf-8'))
assert len(catalog) == 24, 'Expected the verified 24-track render'
match = re.search(r'const musicStyles=(\{.*?\});', text)
assert match, 'Music player catalog not found'
styles = json.loads(match.group(1))
groups = [('edm', 'EDM', 'ncs'), ('vinahouse', 'Vinahouse', 'vinahouse'),
          ('violin', 'Violin', 'violin'), ('piano', 'Piano', 'piano'),
          ('saxophone', 'Saxophone', 'saxophone')]
for key, name, prefix in groups:
    tracks = [{'title': item['title'], 'src': item['path']} for item in catalog
              if pathlib.PurePosixPath(item['path']).name.startswith(prefix + '-')]
    tracks.sort(key=lambda item: item['src'])
    assert len(tracks) == (4 if key == 'saxophone' else 5), (key, len(tracks))
    for track in tracks:
        assert (root / track['src']).is_file(), track['src']
    styles[key] = {'name': name, 'tracks': tracks}
text = text[:match.start(1)] + json.dumps(styles, ensure_ascii=False, separators=(',', ':')) + text[match.end(1):]
options = ''.join('<option value="' + key + '">' + html_lib.escape(style['name']) + '</option>'
                  for key, style in styles.items()) + '<option value="water">Nước chảy</option>'
text, count = re.subn(r'(<select id="musicStyle"[^>]*>).*?(</select>)',
                     lambda m: m[1] + options + m[2], text, count=1)
assert count == 1
credits = '<div id="soundtrackV2Credits"><p>24 bản nhạc mới · EDM, Vinahouse, Violin, Piano: 5 bài mỗi nhóm · Saxophone: 4 bài.</p>'
for key, name, _ in groups:
    credits += '<p>' + name + ': ' + ' · '.join(html_lib.escape(t['title']) for t in styles[key]['tracks']) + '</p>'
credits += ('<p>Các bản mới: Kevin MacLeod ('
            '<a href="https://incompetech.com/" target="_blank" rel="noopener">incompetech.com</a>), '
            '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. '
            'Đã cân bằng âm lượng. Vinahouse là bản phối lại từ tác phẩm gốc: thay đổi tempo, thêm trống, bass và đoạn chuyển. '
            '</p></div>')
text = re.sub(r'<div id="soundtrackV2Credits">.*?</div>', '', text)
text, count = re.subn(r'</details>', lambda _: credits + '</details>', text, count=1)
assert count == 1
text = text.replace("' · 5 bài ngẫu nhiên · '", "' · '+musicStyles[music.style].tracks.length+' bài ngẫu nhiên · '")
assert 'TURN_MS=15000' in text and 'min-width:675px' not in text
page.write_text(text, encoding='utf-8')
print('PASS: attached 24 verified new files, 5 new playlists, attribution; preserved compact board and 15-second turns')

