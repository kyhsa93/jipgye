# R-ONE(한국부동산원 부동산통계정보) 통계표 목록. 키 없이 부르면 한 번에 5줄이라 넘겨 가며 받는다.
import json, urllib.request, os, time
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cache", "rone-tables.json")
def get(url):
    for a in range(6):
        try: return json.load(urllib.request.urlopen(url, timeout=40))
        except Exception: time.sleep(3)
    raise SystemExit("fail " + url)
rows, p = [], 1
while True:
    j = get(f"https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do?Type=json&pIndex={p}&pSize=5")
    total = j["SttsApiTbl"][0]["head"][0]["list_total_count"]
    page = j["SttsApiTbl"][1]["row"]
    rows += page; p += 1
    if len(rows) >= total or not page: break
json.dump(rows, open(OUT, "w"), ensure_ascii=False)
print(len(rows))
