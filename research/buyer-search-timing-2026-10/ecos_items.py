import json, urllib.request, sys, time
def items(stat):
    out, s = [], 1
    while True:
        url = f"https://ecos.bok.or.kr/api/StatisticItemList/sample/json/kr/{s}/{s+9}/{stat}"
        for a in range(5):
            try: j = json.load(urllib.request.urlopen(url, timeout=30)); break
            except Exception: time.sleep(2)
        if "StatisticItemList" not in j: break
        rows = j["StatisticItemList"]["row"]; out += rows; s += 10
        if s > j["StatisticItemList"]["list_total_count"]: break
    return out
for stat in sys.argv[1:]:
    for r in items(stat):
        print(stat, r["GRP_NAME"], r["ITEM_CODE"], r["ITEM_NAME"], r["CYCLE"], r["START_TIME"], r["END_TIME"])
