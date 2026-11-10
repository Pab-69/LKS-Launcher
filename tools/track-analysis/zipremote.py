"""List / extract files of a remote zip with HTTP range requests (no full download)."""
import sys, struct, zlib, urllib.request, os, json, ssl
# a proxy with its own certificate authority: SSL_CERT_FILE=/path/to/ca.crt
CTX = ssl.create_default_context(cafile=os.environ['SSL_CERT_FILE']) if os.environ.get('SSL_CERT_FILE') else ssl.create_default_context()

def fetch(url, start, end):
    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
    with urllib.request.urlopen(req, context=CTX) as r:
        return r.read()

def size_of(url):
    req = urllib.request.Request(url, headers={'Range': 'bytes=0-0'})
    with urllib.request.urlopen(req, context=CTX) as r:
        return int(r.headers['Content-Range'].split('/')[-1])

def central(url, total):
    tail = fetch(url, max(0, total - 70000), total - 1)
    i = tail.rfind(b'PK\x05\x06')
    _, _, _, _, count, cd_size, cd_off, _ = struct.unpack('<IHHHHIIH', tail[i:i + 22])
    if cd_off == 0xFFFFFFFF or count == 0xFFFF:  # zip64
        j = tail.rfind(b'PK\x06\x06')
        count, cd_size, cd_off = struct.unpack('<QQQ', tail[j + 32:j + 56])
    cd = fetch(url, cd_off, cd_off + cd_size - 1)
    entries, p = [], 0
    while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        method = struct.unpack('<H', cd[p + 10:p + 12])[0]
        crc, csize, usize, nlen, elen, clen = struct.unpack('<IIIHHH', cd[p + 16:p + 34])
        off = struct.unpack('<I', cd[p + 42:p + 46])[0]
        name = cd[p + 46:p + 46 + nlen].decode('utf8', 'replace')
        extra = cd[p + 46 + nlen:p + 46 + nlen + elen]
        if 0xFFFFFFFF in (csize, usize, off):  # zip64 extra
            q = 0
            while q < len(extra):
                hid, hsz = struct.unpack('<HH', extra[q:q + 4])
                if hid == 1:
                    vals = list(struct.unpack('<' + 'Q' * (hsz // 8), extra[q + 4:q + 4 + hsz]))
                    if usize == 0xFFFFFFFF: usize = vals.pop(0)
                    if csize == 0xFFFFFFFF: csize = vals.pop(0)
                    if off == 0xFFFFFFFF: off = vals.pop(0)
                q += 4 + hsz
        entries.append({'name': name, 'method': method, 'csize': csize, 'usize': usize, 'off': off})
        p += 46 + nlen + elen + clen
    return entries

def extract(url, e, out_dir):
    head = fetch(url, e['off'], e['off'] + 29)
    nlen, elen = struct.unpack('<HH', head[26:30])
    start = e['off'] + 30 + nlen + elen
    data = fetch(url, start, start + e['csize'] - 1) if e['csize'] else b''
    if e['method'] == 8: data = zlib.decompress(data, -15)
    dest = os.path.join(out_dir, *[x for x in e['name'].split('/') if x not in ('', '..')])
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, 'wb').write(data)
    return dest

if __name__ == '__main__':
    url, out = sys.argv[1], sys.argv[2]
    pattern = sys.argv[3] if len(sys.argv) > 3 else None
    total = size_of(url)
    entries = central(url, total)
    os.makedirs(out, exist_ok=True)
    json.dump(entries, open(os.path.join(out, '_listing.json'), 'w'))
    if pattern:
        import re
        for e in entries:
            if re.search(pattern, e['name'], re.I) and not e['name'].endswith('/'):
                print('extract', e['name'], e['usize'], extract(url, e, out))
    else:
        for e in entries: print(e['usize'], e['name'])
