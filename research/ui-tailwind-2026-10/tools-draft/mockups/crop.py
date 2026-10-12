# PNG 세로 구간 자르기(보기용). 사용: python3 -I crop.py in.png out.png y0 y1  — 의존 없음(zlib).
import sys, zlib, struct
def read(p):
    d=open(p,'rb').read(); assert d[:8]==b'\x89PNG\r\n\x1a\n'; i=8; idat=b''; ihdr=None
    while i<len(d):
        n,=struct.unpack('>I',d[i:i+4]); t=d[i+4:i+8]; c=d[i+8:i+8+n]; i+=12+n
        if t==b'IHDR': ihdr=struct.unpack('>IIBBBBB',c)
        elif t==b'IDAT': idat+=c
    w,h,bd,ct,_,_,il=ihdr; assert bd==8 and il==0
    bpp={2:3,6:4,0:1}[ct]; raw=zlib.decompress(idat); stride=w*bpp; rows=[]; prev=bytearray(stride); pos=0
    for _ in range(h):
        f=raw[pos]; line=bytearray(raw[pos+1:pos+1+stride]); pos+=1+stride
        if f==1:
            for x in range(bpp,stride): line[x]=(line[x]+line[x-bpp])&255
        elif f==2:
            for x in range(stride): line[x]=(line[x]+prev[x])&255
        elif f==3:
            for x in range(stride): line[x]=(line[x]+(((line[x-bpp] if x>=bpp else 0)+prev[x])>>1))&255
        elif f==4:
            for x in range(stride):
                a=line[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
                p=a+b-c; pa=abs(p-a); pb=abs(p-b); pc=abs(p-c)
                line[x]=(line[x]+(a if pa<=pb and pa<=pc else b if pb<=pc else c))&255
        rows.append(line); prev=line
    return w,h,ct,rows
def write(p,w,ct,rows):
    def ch(t,c): return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)&0xffffffff)
    raw=b''.join(b'\x00'+bytes(r) for r in rows)
    open(p,'wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,len(rows),8,ct,0,0,0))+ch(b'IDAT',zlib.compress(raw,6))+ch(b'IEND',b''))
w,h,ct,rows=read(sys.argv[1]); y0=int(sys.argv[3]); y1=min(int(sys.argv[4]),h)
write(sys.argv[2],w,ct,rows[y0:y1]); print(w,y1-y0,'of',h)
