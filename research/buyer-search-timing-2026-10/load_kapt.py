"""K-apt 관리비공개의무단지 기본정보(xlsx, 주 1회 게시)에서 서울만 꺼내 cache/kapt-seoul.json으로.
받은 곳: k-apt.go.kr 소통마당 > 자료실 > 기본정보 탭, 2026-09-25 게시분(로그인 없이 받힘, 2026-10-01 확인)."""
import os, json, re, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
df = pd.read_excel(os.path.join(HERE, "cache", "kapt-basic-20260925.xlsx"), header=None)
# 첫 행은 안내문, 둘째 행이 머리글, 셋째 행부터 단지
hdr = df.iloc[1].tolist()
data = df.iloc[2:].copy(); data.columns = hdr
print("전국 단지", len(data))
seoul = data[data["시도"] == "서울특별시"].copy()
print("서울 단지", len(seoul), "| 단지분류", seoul["단지분류"].value_counts().to_dict())
keep = ["시군구", "동리", "단지코드", "단지명", "단지분류", "법정동주소", "도로명주소", "분양형태", "사용승인일", "동수", "세대수",
        "임대세대수", "난방방식", "복도유형", "총주차대수", "최고층수"]
out = seoul[keep].astype(str).to_dict("records")
json.dump(out, open(os.path.join(HERE, "cache", "kapt-seoul.json"), "w"), ensure_ascii=False)
