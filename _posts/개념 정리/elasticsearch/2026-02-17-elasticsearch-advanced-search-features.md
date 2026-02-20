---
layout: post
title: "Elasticsearch 검색 기능 심화"
date: 2026-02-17
categories: [개념정리, elasticsearch]
tags: [elasticsearch, fuzziness, multi_match, highlight, pagination, multi-field, autocomplete]
---

## 오타 허용 검색 — fuzziness

구글에서 오타를 내더라도 원하는 결과가 잘 나오는 것처럼, Elasticsearch에서도 `match` 쿼리에 `fuzziness` 옵션을 추가하면 오타를 허용하는 검색이 가능하다.

```json
GET /posts/_search
{
  "query": {
    "match": {
      "title": {
        "query": "elastiksearch",
        "fuzziness": "AUTO"
      }
    }
  }
}
```

**fuzziness: "AUTO"** — 단어 길이에 따라 오타 허용 개수를 자동으로 설정한다. 짧은 단어에서는 허용량이 적고, 긴 단어에서는 더 많은 오타를 허용한다. 위 예시에서 "elastiksearch"는 "elasticsearch"와 한 글자만 다르므로 매칭된다.

## 여러 필드에서 동시 검색 — multi_match

구글에서 특정 키워드로 검색하면 사이트의 제목뿐만 아니라 내용까지 포함해서 검색한다. Elasticsearch에서 이런 동작을 구현하는 것이 `multi_match` 쿼리다. 여러 text 타입 필드에서 동시에 검색하며, 매칭되는 필드가 많을수록 Score가 높아진다.

```json
GET /posts/_search
{
  "query": {
    "multi_match": {
      "query": "엘라스틱서치 적용 후기",
      "fields": ["title", "content"]
    }
  }
}
```

title과 content 둘 다에 키워드가 포함된 도큐먼트가 가장 높은 Score를 받고, 한쪽에만 포함된 도큐먼트는 그보다 낮은 Score를 받는다. 두 필드 모두에 키워드가 없는 도큐먼트는 결과에서 제외된다.

### 필드별 가중치 — `^` 연산자

"내용에만 키워드가 있는 글"보다 "제목에 키워드가 있는 글"이 더 관련성 높은 결과일 가능성이 크다. 이런 경우 `^` 기호로 특정 필드에 가중치를 부여할 수 있다.

```json
GET /posts/_search
{
  "query": {
    "multi_match": {
      "query": "엘라스틱서치 적용 후기",
      "fields": ["title^2", "content"]
    }
  }
}
```

`title^2`는 title 필드의 Score에 2배 가중치를 부여한다는 의미다. 이렇게 하면 title에만 키워드가 있는 글이 content에만 있는 글보다 상위에 노출된다.

![multi_match 필드 가중치](/assets/imgs/posts/개념정리/elastic/15-multi-match-boost.png)

## 검색 키워드 하이라이팅 — highlight

구글이나 쿠팡에서 검색 결과를 보면 검색한 키워드가 강조 표시되어 있다. Elasticsearch는 검색 쿼리에 `highlight` 옵션을 추가하면, 응답에서 매칭된 키워드를 지정한 HTML 태그로 감싸서 반환해준다.

```json
GET /posts/_search
{
  "query": {
    "match": { "title": "엘라스틱서치 적용 후기" }
  },
  "highlight": {
    "fields": {
      "title": {
        "pre_tags": ["<mark>"],
        "post_tags": ["</mark>"]
      }
    }
  }
}
```

응답의 `highlight` 필드에 `"<mark>엘라스틱</mark><mark>서치</mark> <mark>적용</mark> <mark>후기</mark>"` 형태로 반환되며, 프론트엔드에서 이 값을 렌더링하면 하이라이팅 처리가 된다. 필드마다 다른 태그를 지정할 수도 있다.

## 페이지네이션과 정렬

### 페이지네이션 — size / from

대량의 데이터를 한 번에 조회하면 서버에 과부하가 걸리므로, 페이지네이션은 필수다. Elasticsearch에서는 `size`와 `from` 두 파라미터로 구현한다.

**size** — 한 번에 가져올 도큐먼트 수. SQL의 `LIMIT`에 해당한다.

**from** — 건너뛸 도큐먼트 수. SQL의 `OFFSET`에 해당하며, 0부터 시작한다.

```json
GET /posts/_search
{
  "from": 6,
  "size": 3,
  "query": {
    "match": { "title": "검색엔진" }
  }
}
```

페이지 번호로부터 from 값을 구하는 공식은 `from = (페이지 번호 - 1) × size`다. size가 3일 때, 1페이지는 from=0, 2페이지는 from=3, 3페이지는 from=6이 된다.

### 정렬 — sort

기본적으로 Elasticsearch는 Score 내림차순으로 결과를 정렬한다. 좋아요 수, 날짜 등 특정 필드 기준으로 정렬하고 싶을 때는 `sort` 옵션을 사용한다.

```json
GET /posts/_search
{
  "query": {
    "match": { "title": "검색엔진" }
  },
  "sort": [
    { "likes": { "order": "desc" } }
  ]
}
```

## 하나의 필드에 두 가지 타입 — Multi Field

text 타입은 유연한 검색(match)에, keyword 타입은 정확한 검색(term)에 사용한다고 했다. 그런데 **하나의 필드에서 유연한 검색과 정확한 검색을 모두** 해야 하는 경우가 있다.

예를 들어, 상품의 `category` 필드에 대해 "가전"이라는 키워드로 유연하게 검색하면서도, 동시에 "특수 가전제품"이라는 정확한 카테고리로 필터링도 하고 싶은 경우다. category를 text로만 정의하면 term 쿼리가 제대로 동작하지 않고, keyword로만 정의하면 match 쿼리로 부분 검색이 불가능하다.

### 해결 — fields 옵션으로 멀티 타입 선언

하나의 필드에 `fields` 옵션으로 서브 필드를 추가하면, 같은 데이터가 두 가지 형태로 동시에 저장된다.

```json
PUT /products
{
  "mappings": {
    "properties": {
      "category": {
        "type": "text",
        "analyzer": "nori",
        "fields": {
          "raw": { "type": "keyword" }
        }
      }
    }
  }
}
```

![Multi Field 저장 구조](/assets/imgs/posts/개념정리/elastic/12-multi-field.png)

"특수 가전제품"을 삽입하면, `category`(text)에는 `[특수, 가전, 제품]`으로 토큰 분리되어 저장되고, `category.raw`(keyword)에는 "특수 가전제품"이 통째로 저장된다. 유연한 검색에서는 `category` 필드를, 정확한 검색에서는 `category.raw` 필드를 사용하면 된다.

## 자동 완성 기능 — search_as_you_type

쿠팡이나 구글 검색창에서 글자를 입력하면 관련 검색어를 실시간으로 추천해준다. Elasticsearch에서는 `search_as_you_type`이라는 전용 데이터 타입으로 이 기능을 구현할 수 있다.

### 동작 원리 — n-gram 멀티 필드

`search_as_you_type`으로 필드를 만들면 내부적으로 세 가지 필드가 생성된다.

- **기본 필드** — 일반 text처럼 개별 토큰으로 분리. `[프리미엄, 감귤, 선물, 세트]`
- **_2gram** — 인접한 2개 토큰을 묶어서 저장. `[프리미엄 감귤, 감귤 선물, 선물 세트]`
- **_3gram** — 인접한 3개 토큰을 묶어서 저장. `[프리미엄 감귤 선물, 감귤 선물 세트]`

![search_as_you_type 토큰 구조](/assets/imgs/posts/개념정리/elastic/13-search-as-you-type.png)

검색할 때는 `multi_match`에 `bool_prefix` 타입을 사용한다.

```json
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "돌김",
      "type": "bool_prefix",
      "fields": ["name", "name._2gram", "name._3gram"]
    }
  }
}
```

**bool_prefix**의 핵심은 마지막 단어를 접두사(prefix)로 처리한다는 점이다. "you have th"로 검색하면 "you"와 "have"는 정확한 토큰 매칭을 하고, 마지막 단어 "th"는 "th"로 시작하는 모든 토큰("the", "this", "that" 등)과 매칭된다. 자동 완성에서 사용자가 단어를 아직 다 입력하지 않은 상태를 자연스럽게 처리하는 방식이다.

### _2gram, _3gram을 함께 검색하는 이유

기본 필드만으로도 검색 자체는 가능하다. _2gram과 _3gram 필드를 함께 검색하는 이유는 **연속된 단어가 일치할수록 Score를 높여** 더 관련성 높은 결과를 상위에 노출하기 위해서다. "구운 돌김"으로 검색하면 "구운 돌김"이라는 2-gram 토큰을 가진 도큐먼트가 "돌김 구운"보다 더 높은 Score를 받는다.

실제 구현에서는 사용자가 글자를 타이핑할 때마다 API 서버에 요청을 보내 자동 완성 후보를 받아오는 방식으로 동작한다.

## 요약

| 기능 | 쿼리/옵션 | 핵심 원리 |
|---|---|---|
| 오타 허용 검색 | `fuzziness: "AUTO"` | 단어 길이에 따라 편집 거리 자동 설정 |
| 여러 필드 검색 | `multi_match` + `^` 가중치 | 복수 필드 동시 검색, 필드별 Score 가중치 |
| 하이라이팅 | `highlight` | 매칭 키워드를 HTML 태그로 감싸서 반환 |
| 페이지네이션 | `size` + `from` | LIMIT/OFFSET과 동일한 개념 |
| 정렬 | `sort` | 특정 필드 기준 오름차순/내림차순 |
| 복합 타입 필드 | `fields` (multi-field) | 하나의 데이터를 text + keyword로 동시 저장 |
| 자동 완성 | `search_as_you_type` + `bool_prefix` | n-gram 토큰 + 마지막 단어 접두사 매칭 |
