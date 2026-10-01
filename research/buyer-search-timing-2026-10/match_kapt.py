"""실거래 원본의 단지(sggCd+umdNm+jibun+aptNm)가 K-apt 단지 기본정보와 몇 % 붙나.

붙이는 순서(앞에서 붙으면 뒤는 안 본다):
 1) 구 + 법정동 + 지번(본번-부번) 일치
 2) 구 + 법정동 + 본번 일치, 같은 본번 후보가 하나뿐이거나 이름이 겹치면
 3) 구 + 법정동 안에서 이름 정규화 일치
 4) 구 안에서 이름 정규화 일치(후보 하나뿐일 때)
단지 수 기준과 거래 수 기준을 같이 낸다. REPO만 바꾸면 된다."""
import os, re, json, glob, collections
REPO = os.environ.get("REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
HERE = os.path.dirname(os.path.abspath(__file__))
kapt = json.load(open(os.path.join(HERE, "cache", "kapt-seoul.json")))
src = open(os.path.join(REPO, "scripts/realestate-districts.mjs")).read()
SGG = dict(re.findall(r'code: "(\d+)", name: "([^"]+)"', src))

def norm(name):
    n = re.sub(r"\(.*?\)", "", str(name))
    n = re.sub(r"[\s\-·.,]", "", n)
    n = n.replace("아파트", "").replace("에이", "a").lower()
    return n

def jb(s):
    s = str(s).strip().rstrip("-")
    m = re.match(r"^(산)?(\d+)(?:-(\d+))?$", s)
    if not m: return None, None
    main = (m.group(1) or "") + str(int(m.group(2)))
    sub = str(int(m.group(3))) if m.group(3) and int(m.group(3)) != 0 else ""
    return main, (main + ("-" + sub if sub else ""))

K_full, K_main, K_name, K_sggname = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
bad = 0
seen = set()
kapt = [k for k in kapt if not (k["단지코드"] in seen or seen.add(k["단지코드"]))]
for k in kapt:
    # "서울특별시 노원구 상계동 652,서울특별시 노원구 상계동 656 상계주공11단지"처럼 지번이 여럿일 수 있다
    dong = k["동리"] if k["동리"] != "nan" else None
    jibuns = re.findall(re.escape(dong) + r" ([산]?\d+(?:-\d*)?)", k["법정동주소"]) if dong else []
    parsed = [jb(j) for j in jibuns]
    parsed = [p for p in parsed if p[0]]
    if not parsed: bad += 1
    g, d = k["시군구"], dong
    for main, full in parsed:
        K_full[(g, d, full)].append(k)
        K_main[(g, d, main)].append(k)
    K_name[(g, d, norm(k["단지명"]))].append(k)
    K_sggname[(g, norm(k["단지명"]))].append(k)

deals = collections.Counter(); first = {}
for f in glob.glob(os.path.join(REPO, "raw/sale/*.json")):
    for it in json.load(open(f))["items"]:
        if str(it.get("cdealType", "")).strip(): continue
        key = (SGG[str(it["sggCd"])], it["umdNm"], str(it["jibun"]), it["aptNm"])
        deals[key] += 1
        first.setdefault(key, it)

how = collections.Counter(); howw = collections.Counter(); matched = {}
for key, n in deals.items():
    g, d, j, name = key
    main, full = jb(j)
    hit, via = None, "없음"
    if full and len(K_full.get((g, d, full), [])) >= 1:
        c = K_full[(g, d, full)]
        hit = c[0] if len(c) == 1 else next((x for x in c if norm(x["단지명"]) == norm(name)), c[0]); via = "1 지번"
    elif main and K_main.get((g, d, main)):
        c = K_main[(g, d, main)]
        nm = [x for x in c if norm(x["단지명"]) == norm(name) or norm(name) in norm(x["단지명"]) or norm(x["단지명"]) in norm(name)]
        if len(c) == 1 or nm: hit = (nm or c)[0]; via = "2 본번"
    if not hit and K_name.get((g, d, norm(name))):
        hit = K_name[(g, d, norm(name))][0]; via = "3 동+이름"
    if not hit and len(K_sggname.get((g, norm(name)), [])) == 1:
        hit = K_sggname[(g, norm(name))][0]; via = "4 구+이름"
    if not hit:
        # 5) 같은 구 안에서 한쪽 이름이 다른 쪽을 품는 후보가 하나뿐이면(재개발로 지번이 바뀐 단지 — 실거래는 옛 지번, K-apt는 새 지번)
        nn = norm(name)
        if len(nn) >= 4:
            c = {x["단지코드"]: x for (gg, kn), xs in K_sggname.items() if gg == g and len(kn) >= 4 and (nn in kn or kn in nn) for x in xs}
            if len(c) == 1: hit = next(iter(c.values())); via = "5 구+이름포함"
    how[via] += 1; howw[via] += n
    if hit: matched[key] = hit

tot, totw = sum(how.values()), sum(howw.values())
print(f"K-apt 서울 {len(kapt)}단지, 지번 파싱 실패 {bad}")
print(f"실거래 단지(구+동+지번+이름) {tot}, 해제 뺀 거래 {totw}")
for v in ["1 지번", "2 본번", "3 동+이름", "4 구+이름", "5 구+이름포함", "없음"]:
    print(f"  {v}: 단지 {how[v]} ({how[v]/tot:.1%})  거래 {howw[v]} ({howw[v]/totw:.1%})")
m = sum(v for k, v in how.items() if k != "없음"); mw = sum(v for k, v in howw.items() if k != "없음")
print(f"붙은 것: 단지 {m/tot:.1%}, 거래 {mw/totw:.1%}")
# 안 붙은 단지의 모습: 거래 수 분포, 이름 예
un = sorted(((n, k) for k, n in deals.items() if k not in matched), reverse=True)
print("안 붙은 단지 거래 수 상위:", [(k[0], k[1], k[2], k[3], n) for n, k in un[:15]])
cnt = collections.Counter(min(n, 10) for n, k in un)
print("안 붙은 단지의 15개월 거래 수 분포(10=10건 이상):", sorted(cnt.items()))
# 구별 거래 기준 매칭률
byg = collections.defaultdict(lambda: [0, 0])
for k, n in deals.items():
    byg[k[0]][1] += n
    if k in matched: byg[k[0]][0] += n
print("구별 거래 매칭률:", {g: f"{a/b:.0%}" for g, (a, b) in sorted(byg.items(), key=lambda x: x[1][0]/x[1][1])})
# 같은 K-apt 단지에 여러 실거래 이름이 붙은 경우(정상: 동별·이름 표기 차)와 오매칭 의심(연식 차 5년 초과)
susp = 0; chk = 0
for k, hit in matched.items():
    by = first[k].get("buildYear"); ua = str(hit["사용승인일"])[:4]
    if by and ua.isdigit():
        chk += 1
        if abs(int(by) - int(ua)) > 5: susp += 1
print(f"오매칭 의심(건축년도와 사용승인 연도가 5년 넘게 차이) {susp}/{chk} = {susp/chk:.1%}")
json.dump({"|".join(map(str, k)): v["단지코드"] for k, v in matched.items()}, open(os.path.join(HERE, "cache", "match.json"), "w"), ensure_ascii=False)
