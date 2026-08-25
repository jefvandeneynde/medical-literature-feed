#!/usr/bin/env python3
"""Refresh the personal literature feed from PubMed.

No secrets are required. The script intentionally uses only Python's standard
library so it can run cheaply and reliably in GitHub Actions.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import shutil
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOPICS_FILE = ROOT / "config" / "topics.json"
OUT_FILE = ROOT / "docs" / "data" / "articles.json"
PUBLIC_TOPICS = ROOT / "docs" / "data" / "topics.json"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
EMAIL = os.getenv("NCBI_EMAIL", "literature-feed@example.com")
TOOL = "medical-literature-feed"


def request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": f"{TOOL}/1.0 ({EMAIL})"})
    with urllib.request.urlopen(req, timeout=45) as response:
        data = response.read()
    time.sleep(0.36)  # stay within NCBI's unauthenticated guidance
    return data


def esearch(term: str, days: int, retmax: int = 100) -> list[str]:
    today = dt.date.today()
    start = today - dt.timedelta(days=days)
    dated = f"({term}) AND ({start:%Y/%m/%d}[Date - Publication] : {today:%Y/%m/%d}[Date - Publication])"
    params = urllib.parse.urlencode({
        "db": "pubmed", "term": dated, "retmode": "json", "retmax": retmax,
        "sort": "pub date", "tool": TOOL, "email": EMAIL,
    })
    payload = json.loads(request(f"{EUTILS}/esearch.fcgi?{params}"))
    return payload.get("esearchresult", {}).get("idlist", [])


def text_of(el):
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def parse_pubdate(article_el) -> tuple[str | None, int | None]:
    pub = article_el.find("./MedlineCitation/Article/Journal/JournalIssue/PubDate")
    if pub is None:
        return None, None
    year = text_of(pub.find("Year"))
    month = text_of(pub.find("Month"))
    day = text_of(pub.find("Day")) or "1"
    medline = text_of(pub.find("MedlineDate"))
    if not year and medline:
        year = medline[:4]
    try:
        y = int(year)
    except Exception:
        return None, None
    months = {m:i for i,m in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],1)}
    try:
        m = int(month) if month.isdigit() else months.get(month[:3].title(), 1)
        d = int(day) if day.isdigit() else 1
        return dt.date(y, m, d).isoformat(), y
    except Exception:
        return f"{y}-01-01", y


def parse_article(article_el, topic_map: dict[str, set[str]]) -> dict:
    med = article_el.find("./MedlineCitation")
    art = med.find("./Article")
    pmid = text_of(med.find("./PMID"))
    title = text_of(art.find("./ArticleTitle"))
    abstract_parts = []
    for a in art.findall("./Abstract/AbstractText"):
        label = a.attrib.get("Label")
        txt = text_of(a)
        abstract_parts.append(f"{label}: {txt}" if label and txt else txt)
    authors = []
    for au in art.findall("./AuthorList/Author"):
        collective = text_of(au.find("CollectiveName"))
        if collective:
            authors.append(collective); continue
        last = text_of(au.find("LastName")); initials = text_of(au.find("Initials"))
        name = " ".join(x for x in [last, initials] if x)
        if name: authors.append(name)
    journal = text_of(art.find("./Journal/Title")) or text_of(med.find("./MedlineJournalInfo/MedlineTA"))
    pub_types = [text_of(x) for x in art.findall("./PublicationTypeList/PublicationType") if text_of(x)]
    doi = None; pmc = None
    for x in article_el.findall("./PubmedData/ArticleIdList/ArticleId"):
        kind = x.attrib.get("IdType"); value = text_of(x)
        if kind == "doi": doi = value
        elif kind == "pmc": pmc = value
    date, year = parse_pubdate(article_el)
    topics = sorted([tid for tid, ids in topic_map.items() if pmid in ids])
    return {
        "id": f"pmid:{pmid}", "pmid": pmid, "doi": doi, "title": title,
        "authors": authors, "journal": journal, "date": date, "year": year,
        "abstract": "\n\n".join(x for x in abstract_parts if x),
        "publication_types": pub_types, "topics": topics,
        "has_full_text": bool(pmc),
        "full_text_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmc}/" if pmc else None,
        "source": "PubMed"
    }


def efetch(pmids: list[str], topic_map: dict[str, set[str]]) -> list[dict]:
    out = []
    for i in range(0, len(pmids), 180):
        ids = pmids[i:i+180]
        params = urllib.parse.urlencode({"db":"pubmed","id":",".join(ids),"retmode":"xml","tool":TOOL,"email":EMAIL})
        root = ET.fromstring(request(f"{EUTILS}/efetch.fcgi?{params}"))
        out.extend(parse_article(x, topic_map) for x in root.findall("./PubmedArticle"))
    return out


def public_topics(config: dict) -> dict:
    return {"groups":[{"id":g["id"],"label":g["label"],"topics":[
        {k:t[k] for k in ("id","label","weight") if k in t} for t in g["topics"] if t.get("enabled",True)
    ]} for g in config["groups"]]}


def main():
    config = json.loads(TOPICS_FILE.read_text(encoding="utf-8"))
    existing = {"articles": []}
    if OUT_FILE.exists():
        try: existing = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        except Exception: pass
    days = 60 if not existing.get("articles") else 10
    topic_map: dict[str, set[str]] = {}
    for group in config["groups"]:
        for topic in group["topics"]:
            if not topic.get("enabled", True): continue
            print(f"Searching {group['label']} / {topic['label']}…")
            try: ids = esearch(topic["query"], days)
            except Exception as exc:
                print(f"  warning: {exc}"); ids = []
            topic_map[topic["id"]] = set(ids)
            print(f"  {len(ids)} records")
    all_ids = sorted(set().union(*topic_map.values()) if topic_map else set())
    fresh = efetch(all_ids, topic_map) if all_ids else []
    old_by_key = {(a.get("pmid") or a.get("doi") or a.get("id")): a for a in existing.get("articles", [])}
    for a in fresh:
        key = a.get("pmid") or a.get("doi") or a.get("id")
        if key in old_by_key:
            # Keep previously assigned topics too, because an item may fall outside
            # the current search window for another topic.
            a["topics"] = sorted(set(a.get("topics", [])) | set(old_by_key[key].get("topics", [])))
        old_by_key[key] = a
    articles = list(old_by_key.values())
    articles.sort(key=lambda a: (a.get("date") or "", a.get("pmid") or ""), reverse=True)
    # Bound static payload while keeping a useful historical archive.
    articles = articles[:12000]
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({"generated_at":dt.datetime.now(dt.timezone.utc).isoformat(),"articles":articles}, ensure_ascii=False, indent=2), encoding="utf-8")
    PUBLIC_TOPICS.write_text(json.dumps(public_topics(config), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(articles)} unique articles")


if __name__ == "__main__":
    main()
