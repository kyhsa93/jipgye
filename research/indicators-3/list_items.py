# ECOS 통계표의 항목 목록(sample 키는 한 번에 10건) - 후보 계열의 항목 코드를 찾는 데 썼다.
import json, sys, urllib.request
def items(stat):
    out, start = [], 1
    while True:
        url = f"https://ecos.bok.or.kr/api/StatisticItemList/sample/json/kr/{start}/{start+9}/{stat}"
        d = json.load(urllib.request.urlopen(url, timeout=30))
        rows = d.get("StatisticItemList", {}).get("row", [])
        out += rows
        total = d.get("StatisticItemList", {}).get("list_total_count", 0)
        start += 10
        if not rows or start > total: break
    return out
for stat in sys.argv[1:]:
    rows = items(stat)
    print("==", stat, len(rows))
    for r in rows:
        print(f"  {r['GRP_NAME']} | {r['ITEM_CODE']} {r['ITEM_NAME']} {r['START_TIME']}~{r['END_TIME']} {r['CYCLE']}")
