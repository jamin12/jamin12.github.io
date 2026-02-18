---
layout: post
title: "Elasticsearch 한글 검색과 Nori Analyzer"
date: 2026-02-16
categories: [개념정리, elasticsearch]
tags: [elasticsearch, nori, analyzer, korean]
---

## 한글 검색이 안 되는 이유

Elasticsearch로 한글 데이터를 다루다 보면 "삼성전자"라는 데이터가 있는데 "삼성"으로 검색하면 결과가 나오지 않는 경우가 있다.

Elasticsearch의 기본 `standard` tokenizer는 공백과 특수문자를 기준으로 텍스트를 토큰으로 분리한다. 영어에서는 이 방식이 동작하지만, 한글은 사정이 다르다.

"삼성전자"를 색인하면 `standard` tokenizer는 이 단어를 통째로 하나의 토큰으로 만든다. 그래서 "삼성"으로 검색해도 "삼성전자" 토큰과 일치하지 않아 결과가 나오지 않는다. 한글은 교착어(조사, 어미가 붙는 언어)이기 때문에, 형태소 단위로 분리해주는 별도의 분석기가 필요하다.

![한글 검색 문제](/assets/imgs/posts/개념정리/elastic/06-korean-problem.png)

## Nori Analyzer

Nori는 Elasticsearch에서 공식으로 제공하는 한국어 형태소 분석 플러그인이다. 한글 텍스트를 형태소 단위로 분리해주기 때문에, "삼성전자"를 "삼성" + "전자"로 나눠서 색인할 수 있다.

Nori Analyzer는 세 가지 핵심 구성 요소로 이루어져 있다.

- **nori_tokenizer** — 한글 텍스트를 형태소 단위로 분리하는 토크나이저
- **nori_part_of_speech** — 특정 품사(조사, 감탄사 등)를 제거하는 토큰 필터
- **nori_readingform** — 한자를 한글 발음으로 변환하는 토큰 필터

## Nori 플러그인 설치

Nori는 기본 내장이 아니라 별도로 설치해야 한다. Docker 환경에서는 Dockerfile에 한 줄 추가한다.

```dockerfile
FROM elasticsearch:8.8.0
RUN elasticsearch-plugin install analysis-nori
```

로컬 환경에서는 아래 명령어로 설치한다.

```bash
bin/elasticsearch-plugin install analysis-nori
```

설치 후 Elasticsearch를 재시작하면 Nori Analyzer를 사용할 수 있다.

## Nori Analyzer 적용

### 기본 설정

인덱스 생성 시 Custom Analyzer에 Nori의 구성 요소를 넣어준다.

```json
"settings": {
  "analysis": {
    "analyzer": {
      "my_nori_analyzer": {
        "char_filter": [],
        "tokenizer": "nori_tokenizer",
        "filter": ["nori_part_of_speech", "nori_readingform"]
      }
    }
  }
}
```

이렇게 설정하면 "삼성전자"가 "삼성" + "전자"로 분리되어 색인되므로, "삼성"으로 검색해도 매칭된다.

### nori_tokenizer의 decompound_mode

`nori_tokenizer`에는 복합어를 어떻게 처리할지 결정하는 `decompound_mode` 옵션이 있다.

- **discard** (기본값) — 복합어를 분리하고 원본은 버린다. "삼성전자" → `[삼성, 전자]`
- **none** — 복합어를 분리하지 않고 원본 그대로 유지한다. "삼성전자" → `[삼성전자]`
- **mixed** — 복합어를 분리하면서 원본도 함께 유지한다. "삼성전자" → `[삼성전자, 삼성, 전자]`

```json
"tokenizer": {
  "my_nori_tokenizer": {
    "type": "nori_tokenizer",
    "decompound_mode": "mixed"
  }
}
```

![Nori decompound_mode 비교](/assets/imgs/posts/개념정리/elastic/07-nori-decompound.png)

### nori_part_of_speech — 불필요한 품사 제거

한글 텍스트에는 "은", "는", "이", "가" 같은 조사가 많이 등장한다. 이런 품사는 검색에 의미가 없으므로 `nori_part_of_speech` 필터로 제거한다.

기본 설정만으로도 일반적인 조사와 감탄사 등을 제거해주며, 필요하면 `stoptags` 옵션으로 제거할 품사 태그를 직접 지정할 수 있다.

### nori_readingform — 한자 → 한글 변환

데이터에 한자가 포함되어 있을 때, `nori_readingform` 필터를 적용하면 한자를 한글 발음으로 변환해준다. "中國"이 "중국"으로 변환되어 색인된다.

## 한글 + 영어 혼합 텍스트 처리

한글과 영어가 섞인 데이터의 경우 Nori Analyzer에 영어용 토큰 필터를 함께 조합한다.

```json
"settings": {
  "analysis": {
    "analyzer": {
      "my_mixed_analyzer": {
        "char_filter": [],
        "tokenizer": "nori_tokenizer",
        "filter": [
          "nori_part_of_speech",
          "nori_readingform",
          "lowercase",
          "stop",
          "stemmer"
        ]
      }
    }
  }
}
```

한글은 Nori가 형태소 분석을 처리하고, 영어는 `lowercase`, `stop`, `stemmer` 필터가 처리한다. "삼성전자 Galaxy S25"라는 텍스트가 있을 때, "삼성"으로도, "galaxy"로도 검색이 가능해진다.

![한글+영어 혼합 분석](/assets/imgs/posts/개념정리/elastic/08-mixed-analyzer.png)

## 요약

| 문제 상황 | 원인 | 해결 방법 |
|---|---|---|
| "삼성"으로 "삼성전자" 검색 불가 | standard tokenizer가 한글 형태소를 분리 못함 | `nori_tokenizer` 사용 |
| 조사("은/는/이/가")가 검색에 방해 | 조사가 토큰에 포함됨 | `nori_part_of_speech` 필터 |
| 한자 데이터 검색 불가 | 한자와 한글이 매칭 안 됨 | `nori_readingform` 필터 |
| 한글+영어 혼합 검색 | 두 언어의 분석 방식이 다름 | Nori + lowercase/stop/stemmer 조합 |

`_analyze` API로 형태소가 어떻게 분리되는지 확인하면서 `decompound_mode`와 품사 필터를 조절할 수 있다.
