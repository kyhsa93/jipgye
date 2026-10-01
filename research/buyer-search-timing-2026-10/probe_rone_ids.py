# R-ONE은 키 없이 목록을 넘겨 받을 수 없다(pIndex 무시). A_2024_NNNNN 꼴 ID를 하나씩 물어 이름을 모은다.
import json, urllib.request, os, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
def one(n):
    sid = f"A_2024_{n:05d}"
    for a in range(4):
        try:
            j = json.load(urllib.request.urlopen(f"https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do?Type=json&pIndex=1&pSize=5&STATBL_ID={sid}", timeout=30))
            rows = j["SttsApiTbl"][1]["row"] if "SttsApiTbl" in j else []
            return [(r["STATBL_ID"], r["STATBL_NM"], r["DTACYCLE_CD"], r["DATA_START_YY"], r["DATA_END_YY"]) for r in rows if r["STATBL_ID"]==sid]
        except Exception: time.sleep(2)
    return []
with ThreadPoolExecutor(8) as ex:
    res = [x for r in ex.map(one, range(0, 1300)) for x in r]
json.dump(res, open(os.path.join(HERE, "cache", "rone-a2024-ids.json"), "w"), ensure_ascii=False)
for r in res: print(*r)
