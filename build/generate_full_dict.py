#!/usr/bin/env python3
"""Build a comprehensive Chinese-Russian dictionary for hover translation.

Uses:
1. Complete HSK 1-9 dataset (11,470 words with pinyin, traditional, definitions, POS)
2. English-to-Russian mapping from dist/dict.json
3. Curated Russian translations for frequent Chinese vocabulary
"""

import json
import os
import re
import ssl
import sys
import urllib.request

ctx = ssl._create_unverified_context()

print("1. Loading en->ru dictionary...")
with open("dist/dict.json", "r", encoding="utf-8") as f:
    en_dict = json.load(f)
en_ru = en_dict.get("w", {})

print(f"Loaded {len(en_ru)} en->ru words.")

print("2. Downloading HSK 1-9 complete vocabulary...")
url = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
    hsk_data = json.loads(resp.read().decode("utf-8"))

print(f"Downloaded {len(hsk_data)} HSK entries.")

# Frequent Chinese words translations to Russian
COMMON_ZH_RU = {
    # Web / Tech / UI
    "百度": {"p": "bai3 du4", "t": ["Байду (поисковая система)", "сотни раз"], "pos": "собств."},
    "搜索": {"p": "sou1 suo3", "t": ["искать", "поиск"], "pos": "гл."},
    "新闻": {"p": "xin1 wen2", "t": ["новости", "известия"], "pos": "сущ."},
    "地图": {"p": "di4 tu2", "t": ["карта", "географическая карта"], "pos": "сущ."},
    "贴吧": {"p": "tie1 ba1", "t": ["Тьеба (форум Байду)"], "pos": "сущ."},
    "视频": {"p": "shi4 pin2", "t": ["видео", "видеоролик"], "pos": "сущ."},
    "图片": {"p": "tu2 pian4", "t": ["картинка", "изображение", "фото"], "pos": "сущ."},
    "网盘": {"p": "wang3 pan2", "t": ["облачный диск", "сетевое хранилище"], "pos": "сущ."},
    "设置": {"p": "she4 zhi4", "t": ["настройки", "устанавливать"], "pos": "гл."},
    "登录": {"p": "deng1 lu4", "t": ["войти", "вход", "логин"], "pos": "гл."},
    "注册": {"p": "zhu4 ce4", "t": ["регистрация", "зарегистрироваться"], "pos": "гл."},
    "首页": {"p": "shou3 ye4", "t": ["главная страница"], "pos": "сущ."},
    "更多": {"p": "geng4 duo1", "t": ["больше", "еще"], "pos": "нареч."},
    "关于": {"p": "guan1 yu2", "t": ["о", "об", "относительно"], "pos": "предл."},
    "帮助": {"p": "bang1 zhu4", "t": ["помощь", "помогать"], "pos": "гл."},
    "下载": {"p": "xia4 zai3", "t": ["скачать", "загрузка"], "pos": "гл."},
    "刷新": {"p": "shua1 xin1", "t": ["обновить"], "pos": "гл."},
    "返回": {"p": "fan3 hui2", "t": ["вернуться", "назад"], "pos": "гл."},
    "确定": {"p": "que4 ding4", "t": ["подтвердить", "точно"], "pos": "гл."},
    "取消": {"p": "qu3 xiao1", "t": ["отмена", "отменить"], "pos": "гл."},
    "提交": {"p": "ti2 jiao1", "t": ["отправить", "передать"], "pos": "гл."},
    "保存": {"p": "bao3 cun2", "t": ["сохранить"], "pos": "гл."},
    "删除": {"p": "shan1 chu2", "t": ["удалить"], "pos": "гл."},
    "编辑": {"p": "bian1 ji2", "t": ["редактировать"], "pos": "гл."},
    "分享": {"p": "fen1 xiang3", "t": ["поделиться"], "pos": "гл."},
    "收藏": {"p": "shou1 cang2", "t": ["избранное", "сохранить в закладки"], "pos": "гл."},
    "关注": {"p": "guan1 zhu4", "t": ["подписаться", "следить"], "pos": "гл."},
    "点赞": {"p": "dian3 zan4", "t": ["лайкнуть", "поставить лайк"], "pos": "гл."},
    "评论": {"p": "ping2 lun4", "t": ["комментарий", "комментировать"], "pos": "сущ."},
    "消息": {"p": "xiao1 xi", "t": ["сообщение", "весть"], "pos": "сущ."},
    "通知": {"p": "tong1 zhi1", "t": ["уведомление", "известить"], "pos": "сущ."},
    "个人中心": {"p": "ge4 ren2 zhong1 xin1", "t": ["личный кабинет", "профиль"], "pos": "сущ."},
    # E-commerce / Goofish (闲鱼)
    "闲鱼": {"p": "xian2 yu2", "t": ["Сяньюй (Goofish, барахолка Alibaba)"], "pos": "собств."},
    "宝贝": {"p": "bao3 bei4", "t": ["товар", "сокровище", "детка"], "pos": "сущ."},
    "买家": {"p": "mai3 jia1", "t": ["покупатель"], "pos": "сущ."},
    "卖家": {"p": "mai4 jia1", "t": ["продавец"], "pos": "сущ."},
    "价格": {"p": "jia4 ge2", "t": ["цена", "стоимость"], "pos": "сущ."},
    "包邮": {"p": "bao1 you2", "t": ["бесплатная доставка"], "pos": "прил."},
    "成色": {"p": "cheng2 se4", "t": ["состояние товара", "проба"], "pos": "сущ."},
    "全新": {"p": "quan2 xin1", "t": ["абсолютно новый"], "pos": "прил."},
    "二手": {"p": "er4 shou3", "t": ["бывший в употреблении", "б/у"], "pos": "прил."},
    "转卖": {"p": "zhuan3 mai4", "t": ["перепродать", "перепродажа"], "pos": "гл."},
    "自提": {"p": "zi4 ti2", "t": ["самовывоз"], "pos": "сущ."},
    "拍下": {"p": "pai1 xia4", "t": ["оформить заказ", "купить"], "pos": "гл."},
    "付款": {"p": "fu4 kuan3", "t": ["оплатить", "платеж"], "pos": "гл."},
    "发货": {"p": "fa1 huo4", "t": ["отправить товар", "отгрузка"], "pos": "гл."},
    "退款": {"p": "tui4 kuan3", "t": ["возврат средств"], "pos": "гл."},
    "退货": {"p": "tui4 huo4", "t": ["возврат товара"], "pos": "гл."},
    "评价": {"p": "ping2 jia4", "t": ["отзыв", "оценка"], "pos": "сущ."},
    "砍价": {"p": "kan3 jia4", "t": ["торговаться", "сбивать цену"], "pos": "гл."},
    "小刀": {"p": "xiao3 dao1", "t": ["небольшой торг"], "pos": "нареч."},
    "专柜": {"p": "zhuan1 gui4", "t": ["фирменная витрина", "бутик"], "pos": "сущ."},
    "正品": {"p": "zheng4 pin3", "t": ["оригинальный товар", "подлинник"], "pos": "сущ."},
    "瑕疵": {"p": "xia2 ci1", "t": ["дефект", "изъян"], "pos": "сущ."},
    "实拍": {"p": "shi2 pai1", "t": ["реальное фото"], "pos": "сущ."},
    "包退": {"p": "bao1 tui4", "t": ["гарантия возврата"], "pos": "прил."},
    "验货": {"p": "yan4 huo4", "t": ["проверка товара"], "pos": "гл."},
    "立即购买": {"p": "li4 ji2 gou4 mai3", "t": ["купить сейчас"], "pos": "фраза"},
    "加入购物车": {"p": "jia1 ru4 gou4 wu4 che1", "t": ["в корзину"], "pos": "фраза"},
    "购物车": {"p": "gou4 wu4 che1", "t": ["корзина"], "pos": "сущ."},
    "客服": {"p": "ke4 fu2", "t": ["служба поддержки", "оператор"], "pos": "сущ."},
    "店铺": {"p": "dian4 pu4", "t": ["магазин", "лавка"], "pos": "сущ."},
    "推荐": {"p": "tui1 jian4", "t": ["рекомендовать", "рекомендация"], "pos": "гл."},
    "热门": {"p": "re4 men2", "t": ["популярный", "хит"], "pos": "прил."},
    "关注": {"p": "guan1 zhu4", "t": ["подписаться", "внимание"], "pos": "гл."},
    "粉丝": {"p": "fen3 si1", "t": ["подписчики", "фанаты"], "pos": "сущ."},
    "信用": {"p": "xin4 yong4", "t": ["рейтинг доверия", "кредит"], "pos": "сущ."},
    "极速": {"p": "ji2 su4", "t": ["сверхбыстрый", "экспресс"], "pos": "прил."},
    "回收": {"p": "hui2 shou1", "t": ["скупка", "выкуп", "утилизация"], "pos": "гл."},
    "同城": {"p": "tong2 cheng2", "t": ["в том же городе", "местный"], "pos": "прил."},
}

print("3. Building unified dictionary...")
words = {}

# Seed with curated common words
for k, v in COMMON_ZH_RU.items():
    words[k] = {
        "p": v["p"],
        "t": v["t"],
        "trad": v.get("trad", k),
    }
    if "pos" in v:
        words[k]["pos"] = v["pos"]

# Process HSK entries
for item in hsk_data:
    simp = item.get("s")
    if not simp:
        continue
    forms = item.get("f", [])
    if not forms:
        continue
    f0 = forms[0]
    pinyin = f0.get("i", {}).get("n", "")
    trad = f0.get("t", simp)
    meanings = f0.get("m", [])

    # Map English definitions to Russian via en_ru dictionary
    ru_senses = []
    for m in meanings:
        # Normalize English phrase
        cleaned = re.sub(r"^(to|a|an)\s+", "", m.lower())
        first_part = cleaned.split(";")[0].split(",")[0].strip()
        ru = en_ru.get(first_part)
        if ru:
            if isinstance(ru, list):
                ru_senses.extend(ru[:2])
            elif isinstance(ru, str):
                ru_senses.append(ru)
        else:
            # Try single token
            tokens = re.findall(r"[a-z]+", first_part)
            for tok in tokens:
                if tok in en_ru:
                    t_ru = en_ru[tok]
                    if isinstance(t_ru, list):
                        ru_senses.append(t_ru[0])
                    elif isinstance(t_ru, str):
                        ru_senses.append(t_ru)
                    break
        if len(ru_senses) >= 2:
            break

    # If no Russian translation found, keep concise English meanings as fallback
    final_senses = ru_senses if ru_senses else meanings[:2]

    # Clean senses
    clean_senses = [s.strip(" ;.,") for s in final_senses if s.strip(" ;.,")]
    if not clean_senses:
        continue

    # Keep curated if already present
    if simp in words:
        if trad and trad != simp:
            words[simp]["trad"] = trad
        continue

    entry = {
        "p": pinyin,
        "t": clean_senses[:3],
        "trad": trad,
    }
    pos_list = item.get("p", [])
    if pos_list:
        pos_map = {
            "n": "сущ.", "v": "гл.", "adj": "прил.", "adv": "нареч.",
            "prep": "предл.", "conj": "союз", "pron": "мест.", "num": "числ.",
            "m": "сч. сл.", "part": "част.", "int": "межд."
        }
        pos_str = pos_map.get(pos_list[0].lower())
        if pos_str:
            entry["pos"] = pos_str

    words[simp] = entry

print(f"Total vocabulary size: {len(words)} entries.")

# Write BKRS dictionary
bkrs_dict = {
    "v": 1,
    "lang": "zh-ru",
    "w": words
}

out_bkrs = "dist/dict-zh-bkrs.json"
out_cedict = "dist/dict-zh-cedict.json"

with open(out_bkrs, "w", encoding="utf-8") as f:
    json.dump(bkrs_dict, f, ensure_ascii=False, separators=(",", ":"))

with open(out_cedict, "w", encoding="utf-8") as f:
    json.dump(bkrs_dict, f, ensure_ascii=False, separators=(",", ":"))

size_mb = os.path.getsize(out_bkrs) / (1024 * 1024)
print(f"Saved {out_bkrs} and {out_cedict}: {size_mb:.2f} MB ({len(words)} words)")
