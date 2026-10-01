"""시장 온도 후보 지표를 받아 cache/series.json에 모은다.

- ECOS: sample 키, 10줄씩 start를 넘겨 받는다.
- R-ONE(한국부동산원 부동산통계정보 OpenAPI): 키 없이 부르면 5줄만 주고 pIndex를 무시한다.
  그래서 START_WRTTIME~END_WRTTIME을 5개월씩 잘라 부른다(CLS_ID·ITM_ID로 한 계열만).
확인일 2026-10-01.
"""
import json, os, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cache", "series.json")

def get(url):
    for a in range(6):
        try:
            return json.load(urllib.request.urlopen(url, timeout=40))
        except Exception:
            time.sleep(2 + a)
    raise RuntimeError(url)

def ecos(stat, cycle, frm, to, *items):
    rows, s = [], 1
    while True:
        url = f"https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/{s}/{s+9}/{stat}/{cycle}/{frm}/{to}/" + "/".join(items)
        j = get(url)
        if "StatisticSearch" not in j:
            break
        page = j["StatisticSearch"]["row"]
        rows += page
        s += 10
        if s > j["StatisticSearch"]["list_total_count"]:
            break
    return sorted({r["TIME"]: float(r["DATA_VALUE"]) for r in rows if r["DATA_VALUE"] not in ("", None)}.items())

def ym_add(ym, d):
    i = int(ym[:4]) * 12 + int(ym[4:]) - 1 + d
    return f"{i // 12}{i % 12 + 1:02d}"

def rone(statbl, cls, itm, frm, to):
    out, m = {}, frm
    while m <= to:
        end = min(ym_add(m, 4), to)
        url = ("https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?Type=json&pIndex=1&pSize=5"
               f"&STATBL_ID={statbl}&DTACYCLE_CD=MM&CLS_ID={cls}&ITM_ID={itm}&START_WRTTIME={m}&END_WRTTIME={end}")
        j = get(url)
        for r in (j.get("SttsApiTblData", [{}, {}])[1].get("row", []) if "SttsApiTblData" in j else []):
            out[r["WRTTIME_IDTFR_ID"]] = float(r["DTA_VAL"])
        m = ym_add(end, 1)
    return sorted(out.items())

S = {}
S["kb_sale"] = ecos("901Y062", "M", "198601", "202609", "P63ACA")
S["kb_jeonse"] = ecos("901Y063", "M", "198601", "202609", "P64ACA")
S["base_rate"] = ecos("722Y001", "M", "199905", "202609", "0101000")
S["mortgage_rate"] = ecos("121Y006", "M", "200109", "202608", "BECBLA0302")
S["ktb3"] = ecos("721Y001", "M", "199505", "202609", "5020000")
S["unsold_seoul"] = ecos("901Y074", "M", "200701", "202607", "I410B")
S["csi_house_seoul"] = ecos("511Y002", "M", "201301", "202609", "FMFB", "F0001")
S["vol_seoul"] = rone("A_2024_00554", 500002, 100001, "200601", "202609")
S["jratio_seoul"] = rone("A_2024_00072", 500008, 100001, "201201", "202609")
S["supply_demand_seoul"] = rone("A_2024_00076", 500008, 100001, "201201", "202609")
json.dump(S, open(OUT, "w"))
for k, v in S.items():
    print(k, len(v), v[0], v[-1])
