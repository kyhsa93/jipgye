# ECOS 통계표 목록 전체(844개)를 sample 키로 10줄씩 받아 캐시한다.
import json, urllib.request, os, time
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "ecos-tables.json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
rows = []
start = 1
while True:
    url = f"https://ecos.bok.or.kr/api/StatisticTableList/sample/json/kr/{start}/{start+9}/"
    for attempt in range(5):
        try:
            j = json.load(urllib.request.urlopen(url, timeout=30)); break
        except Exception as e:
            time.sleep(2)
    page = j.get("StatisticTableList", {}).get("row", [])
    rows += page
    total = j["StatisticTableList"]["list_total_count"]
    start += 10
    if start > total or not page: break
json.dump(rows, open(OUT, "w"), ensure_ascii=False, indent=0)
print(len(rows))
