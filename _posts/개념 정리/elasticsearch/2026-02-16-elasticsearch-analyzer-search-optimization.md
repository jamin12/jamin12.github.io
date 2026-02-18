---
layout: post
title: "Elasticsearch Analyzer 구조와 검색 최적화"
date: 2026-02-16
categories: [개념정리, elasticsearch]
tags: [elasticsearch, analyzer, tokenizer, filter]
---

## Analyzer 개요

Elasticsearch에서 검색이 기대대로 동작하지 않는 경우가 있다. 대소문자가 달라서, HTML 태그가 섞여 있어서, 단어 형태가 달라서 등 다양한 원인이 있는데, 이런 문제는 Analyzer 설정으로 해결한다. Analyzer를 이해하려면 먼저 Elasticsearch가 데이터를 어떻게 저장하고 검색하는지 알아야 한다.

## 역인덱스 (Inverted Index)

### 검색어 순서가 상관없는 이유

MySQL 같은 관계형 DB에서 `LIKE '%quick brown%'`로 검색하면 "quick brown"이라는 정확한 순서의 문자열만 찾는다. 하지만 Elasticsearch에서 "quick brown"을 검색하면 "brown quick"이 포함된 문서도 찾아준다. 이것이 가능한 이유가 **역인덱스(Inverted Index)** 구조 때문이다.

### 역인덱스의 구조

Elasticsearch는 문서를 색인할 때, 텍스트를 Analyzer로 처리하여 토큰으로 분리한 뒤, 각 토큰이 어떤 문서에 등장하는지를 기록한 테이블을 만든다. 이것이 역인덱스다.

예를 들어 세 개의 문서가 있다고 하자.

- Doc 1: "The quick brown fox"
- Doc 2: "The quick rabbit"
- Doc 3: "Brown fox jumps"

이 문서들을 Analyzer가 처리하면 아래와 같은 역인덱스가 만들어진다.

| Token | Document IDs |
|---|---|
| the | Doc 1, Doc 2 |
| quick | Doc 1, Doc 2 |
| brown | Doc 1, Doc 3 |
| fox | Doc 1, Doc 3 |
| rabbit | Doc 2 |
| jumps | Doc 3 |

"quick brown"을 검색하면, Elasticsearch는 역인덱스에서 `quick`과 `brown`을 각각 조회한다. `quick`은 Doc 1, Doc 2에 있고, `brown`은 Doc 1, Doc 3에 있다. 두 토큰 모두 포함된 Doc 1이 가장 관련도가 높다고 판단하여 상위에 노출한다. 토큰 단위로 조회하기 때문에 검색어 순서는 상관없다.

![역인덱스 구조](/assets/imgs/posts/개념정리/elastic/00-inverted-index.png)

## Score — 검색 결과의 관련도 점수

Elasticsearch는 검색 결과를 반환할 때 각 문서에 **Score**를 부여하여 관련도 순으로 정렬한다. Score는 세 가지 요소로 계산된다.

**TF (Term Frequency)** — 해당 문서에 검색 토큰이 많이 등장할수록 Score가 높아진다. "fox"가 3번 등장하는 문서가 1번 등장하는 문서보다 더 관련성이 높다고 판단하는 것이다.

**IDF (Inverse Document Frequency)** — 전체 문서에서 드물게 등장하는 토큰일수록 Score가 높아진다. "the"처럼 거의 모든 문서에 등장하는 토큰은 변별력이 낮으므로 낮은 가중치를 받고, "elasticsearch"처럼 특정 문서에만 등장하는 토큰은 높은 가중치를 받는다.

**Field Length Normalization** — 필드의 전체 길이가 짧을수록 Score가 높아진다. 3단어짜리 문서에서 "fox"가 등장하는 것이 100단어짜리 문서에서 등장하는 것보다 더 관련성이 높다고 보는 것이다.

![Score 계산의 3가지 요소](/assets/imgs/posts/개념정리/elastic/00-score.png)

이 세 가지 값을 종합하여 최종 Score가 결정되고, 이 Score가 높은 문서부터 검색 결과에 노출된다. Elasticsearch의 검색 품질은 결국 역인덱스에 어떤 토큰이 들어가느냐에 달려 있고, 그것을 결정하는 것이 **Analyzer**다.

## Analyzer의 구조

Analyzer는 세 가지 구성 요소로 이루어져 있다.

- **Character Filter** — 텍스트를 토큰으로 분리하기 전에 전처리하는 단계다. HTML 태그 제거, 특정 문자 치환 등을 수행한다.
- **Tokenizer** — 전처리된 텍스트를 규칙에 따라 토큰(단어)으로 분리한다. `standard`, `whitespace`, `keyword` 등이 있다.
- **Token Filter** — 분리된 토큰을 후처리한다. 소문자 변환, 불용어 제거, 형태소 분석, 동의어 처리 등이 해당한다.

텍스트는 `Character Filter → Tokenizer → Token Filter` 순서로 처리된다. 이 파이프라인을 커스터마이징한 것이 Custom Analyzer다.

![Analyzer Pipeline](/assets/imgs/posts/개념정리/elastic/01-analyzer-pipeline.png)

## 1. 대소문자 구분 없이 검색 — lowercase Token Filter

기본 `standard` analyzer는 소문자 변환을 포함하지만, `keyword` tokenizer처럼 텍스트 전체를 하나의 토큰으로 다루는 경우에는 대소문자가 그대로 유지된다.

Custom Analyzer에 `lowercase` token filter를 적용하면 대소문자 구분 없이 검색된다.

```json
"analyzer": {
  "my_custom_analyzer": {
    "char_filter": [],
    "tokenizer": "keyword",
    "filter": ["lowercase"]
  }
}
```

`"The Quick Brown Fox"`로 색인된 데이터가 `"the quick brown fox"`로도 검색된다.

![lowercase Token Filter](/assets/imgs/posts/개념정리/elastic/02-lowercase.png)

## 2. HTML 태그 제거 — html_strip Character Filter

HTML 태그가 포함된 텍스트를 색인하면 태그가 토큰에 포함된다. `<p>Hello</p>`를 색인하면 `<p>Hello</p>` 전체가 토큰이 된다.

`html_strip` character filter를 사용하면 색인 전에 HTML 태그가 제거된다.

```json
"analyzer": {
  "my_html_analyzer": {
    "char_filter": ["html_strip"],
    "tokenizer": "keyword",
    "filter": []
  }
}
```

`<p>Hello</p>`가 `Hello`로 변환되어 색인된다.

![html_strip Character Filter](/assets/imgs/posts/개념정리/elastic/03-html-strip.png)

## 3. 불용어 제거 — stop Token Filter

영어 텍스트에는 `a`, `an`, `the`, `or`, `but` 같은 불용어(stopword)가 빈번하게 등장한다. 이런 단어들은 검색 의미에 기여하지 않으면서 인덱스 크기만 키운다.

`stop` token filter를 적용하면 불용어가 색인 시점에 제거된다.

```json
"analyzer": {
  "my_stop_analyzer": {
    "char_filter": [],
    "tokenizer": "standard",
    "filter": ["lowercase", "stop"]
  }
}
```

기본적으로 영어 불용어 목록이 제공되며, 커스텀 불용어 목록을 지정할 수도 있다. 한국어의 경우 별도의 불용어 사전을 구성해서 사용한다.

## 4. 단어 형태에 상관없이 검색 — stemmer Token Filter

영어에서는 `fox`, `foxes`, `foxing`처럼 같은 의미의 단어가 다양한 형태로 존재한다. `fox`를 검색했을 때 `foxes`가 포함된 문서도 검색되어야 하는 경우가 있다.

`stemmer` token filter는 단어를 어간(stem)으로 변환한다. `foxes → fox`, `running → run`으로 변환되어 색인된다.

```json
"analyzer": {
  "my_stemmer_analyzer": {
    "char_filter": [],
    "tokenizer": "standard",
    "filter": ["lowercase", "stop", "stemmer"]
  }
}
```

stemmer는 언어별로 다르게 동작하므로 대상 언어에 맞는 설정이 필요하다.

![stop + stemmer Token Filter](/assets/imgs/posts/개념정리/elastic/04-stop-stemmer.png)

## 5. 동의어로 검색 — synonym Token Filter

`quick`을 검색했을 때 `fast`가 포함된 문서도 검색되어야 하는 경우, 동의어 처리가 필요하다.

`synonym` token filter를 통해 동의어를 정의한다. 동의어 규칙은 두 가지 방식이 있다.

### 양방향 (Equivalent) — 쉼표(`,`)로 구분

쉼표로 나열된 단어들은 서로 동등하게 취급된다. 어떤 단어로 검색하든 나머지 단어가 포함된 문서도 매칭된다.

```json
"filter": {
  "my_synonym_filter": {
    "type": "synonym",
    "synonyms": [
      "notebook, 노트북, 렙탑, 휴대용 컴퓨터, laptop",
      "samsung, 삼성"
    ]
  }
}
```

"렙탑"을 검색하면 "notebook", "노트북", "laptop", "휴대용 컴퓨터"가 포함된 문서도 검색된다.

### 단방향 (Explicit) — `=>`로 구분

`=>` 왼쪽 단어를 검색하면 오른쪽 단어도 매칭되지만, 반대 방향은 매칭되지 않는다.

```json
"filter": {
  "my_synonym_filter": {
    "type": "synonym",
    "synonyms": [
      "아이폰 => 스마트폰",
      "갤럭시 => 스마트폰"
    ]
  }
}
```

"아이폰"을 검색하면 "스마트폰"이 포함된 문서도 나오지만, "스마트폰"을 검색했을 때 "아이폰" 문서는 나오지 않는다. 하위 개념에서 상위 개념으로 확장할 때 사용한다.

### 양방향과 단방향을 함께 사용

같은 필터 안에서 두 방식을 함께 사용할 수 있다.

```json
"filter": {
  "my_synonym_filter": {
    "type": "synonym",
    "synonyms": [
      "notebook, 노트북, 렙탑, laptop",
      "아이폰 => 스마트폰"
    ]
  }
},
"analyzer": {
  "my_synonym_analyzer": {
    "char_filter": [],
    "tokenizer": "standard",
    "filter": ["lowercase", "my_synonym_filter"]
  }
}
```

동의어가 많을 경우 외부 파일(`synonyms_path`)로 관리하는 방식도 있다.

![synonym Token Filter](/assets/imgs/posts/개념정리/elastic/05-synonym.png)

## 요약

| 문제 상황 | 해결 방법 | 사용 컴포넌트 |
|---|---|---|
| 대소문자 때문에 검색 누락 | `lowercase` filter | Token Filter |
| HTML 태그가 검색에 방해 | `html_strip` char filter | Character Filter |
| 불필요한 단어가 인덱스 비대화 | `stop` filter | Token Filter |
| 단어 형태 변화로 검색 누락 | `stemmer` filter | Token Filter |
| 동의어 검색 불가 | `synonym` filter | Token Filter |

`_analyze` API를 사용하면 각 단계에서 텍스트가 어떻게 변환되는지 확인할 수 있다.
