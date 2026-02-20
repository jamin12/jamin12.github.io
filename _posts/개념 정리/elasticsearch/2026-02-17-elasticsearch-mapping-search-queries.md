---
layout: post
title: "Elasticsearch 매핑과 검색 쿼리"
date: 2026-02-17
categories: [개념정리, elasticsearch]
tags: [elasticsearch, mapping, match, term, bool, range, search_as_you_type, pagination, sort]
---

## 매핑(mapping)과 데이터 타입

매핑(mapping)이란 도큐먼트의 각 필드가 어떤 데이터 타입을 가지는지 정의하는 설정이다. MySQL에서 테이블을 만들 때 스키마(schema)를 정의하는 것처럼, Elasticsearch에서는 인덱스를 만들 때 매핑을 정의한다.

### text vs keyword — 문자열의 두 가지 저장 방식

Elasticsearch에서 문자열을 다루는 타입은 두 가지가 있다. 이 둘의 차이는 **저장 시 토큰 분리 여부**다.

**text** — Analyzer를 거쳐 토큰으로 분리해서 저장한다. "특수 가전제품"이라는 값을 넣으면 `[특수, 가전, 제품]`으로 쪼개져서 역인덱스에 들어간다. 그래서 "가전"으로 검색해도 매칭된다. 상품명, 게시글 제목, 본문처럼 유연한 검색이 필요한 필드에 사용한다.

**keyword** — 값을 그대로 통째로 저장한다. "특수 가전제품"이 하나의 토큰으로 들어간다. 그래서 정확히 "특수 가전제품"으로 검색해야만 매칭되고, "가전"이나 "특수가전제품"으로는 조회되지 않는다. 카테고리, 이메일, 주문번호처럼 정확한 일치 비교가 필요한 필드에 사용한다.

![text vs keyword 저장 방식 비교](/assets/imgs/posts/개념정리/elastic/09-text-vs-keyword.png)

여기서 중요한 포인트가 하나 있다. 계산에 사용하지 않는 값이라면 숫자처럼 보이더라도 keyword로 저장해야 한다. 휴대폰 번호(`010-1234-5678`)나 주민등록번호에 사칙연산을 하지 않으므로, 이런 값은 숫자가 아닌 문자로 다뤄야 한다.

### 숫자·기타 타입

숫자 타입은 범위에 따라 선택한다. **integer**는 10억 이하의 정수, **long**은 그 이상의 정수, **double**은 소수점이 포함된 실수에 사용한다. 현업에서는 확장성을 고려해 id 같은 필드에 integer 대신 long을 쓰는 편이다. 이 외에 날짜에는 **date**, 참/거짓에는 **boolean** 타입을 사용한다.

### 매핑의 특이한 특징 — null과 배열 허용

MySQL과 달리 Elasticsearch의 매핑은 제약이 느슨하다.

**null 허용** — 매핑에 필드를 정의하더라도 해당 필드가 반드시 존재해야 한다는 제약이 없다. 필드 값이 null이거나 필드 자체가 빠져 있어도 도큐먼트가 정상적으로 삽입된다.

**배열 허용** — 배열 전용 타입이 별도로 존재하지 않는다. text로 정의한 필드에 `"여행"`을 넣어도 되고 `["여행", "요리"]`를 넣어도 된다. 두 경우 모두 "여행"으로 검색하면 조회된다.

## 검색 쿼리의 두 가지 방향 — match vs term

Elasticsearch의 검색 쿼리는 크게 두 종류로 나뉜다. **유연한 검색**을 위한 `match` 계열과 **정확한 검색**을 위한 `term` 계열이다. 이 구분은 매핑의 text/keyword 타입 구분과 직접 연결된다.

![match vs term 쿼리 비교](/assets/imgs/posts/개념정리/elastic/14-match-vs-term.png)

### match — 키워드가 포함된 데이터 조회

`match` 쿼리는 검색어를 Analyzer로 토큰 분리한 뒤, 역인덱스에서 각 토큰이 포함된 도큐먼트를 찾는다. **text 타입 필드에서만 사용하는 쿼리**다. 정확히 일치하지 않아도 관련성이 있는 데이터를 조회하며, Score(관련도 점수)를 계산해 관련성이 높은 순서로 정렬한다.

"편의점 과자 내돈내산 후기"라는 데이터가 있을 때 "편의점 후기"로 검색하면, 검색어가 `[편의점, 후기]`로 분리되고, 두 토큰 모두 해당 도큐먼트의 역인덱스에 존재하므로 매칭된다.

### term / terms — 정확한 값 일치 조회

`term` 쿼리는 검색어를 토큰 분리 없이 그대로 비교한다. **text를 제외한 모든 타입**(keyword, long, boolean 등)에서 사용한다. SQL의 `WHERE category = '자유 게시판'`과 동일한 역할이다. "자유"나 "자유게시판"으로는 "자유 게시판" 데이터를 조회할 수 없다.

`terms`는 `term`의 복수형으로, 여러 값 중 하나라도 일치하는 도큐먼트를 조회한다. SQL의 `IN`과 동일한 역할이다.

## 조건 조합 — bool 쿼리

실무에서는 단일 조건으로 검색하는 경우가 거의 없다. "자유 게시판의 게시글 중에서 '검색엔진' 키워드와 관련된 글을 찾되, 공지글은 제외하고, 평점 높은 글을 상위에 노출"하는 식으로 여러 조건을 조합해야 한다. 이때 사용하는 것이 `bool` 쿼리다.

`bool` 쿼리는 네 가지 절(clause)로 구성된다.

![bool 쿼리 구조](/assets/imgs/posts/개념정리/elastic/10-bool-query-structure.png)

- **must** — 반드시 만족해야 하는 조건. Score에 영향을 **준다**.
- **filter** — 반드시 만족해야 하는 조건. Score에 영향을 **주지 않는다**.
- **must_not** — 반드시 만족하지 않아야 하는 조건. SQL의 NOT 역할.
- **should** — 만족하면 Score에 가산점을 부여하지만, 필수 조건은 아니다.

### must와 filter — 같은 AND, 다른 용도

`must`와 `filter` 모두 AND 역할을 하지만, **Score에 영향을 주느냐**가 다르다. Score는 `match`처럼 유연한 검색에서 관련도를 계산하는 데 사용되고, `term`처럼 정확한 일치 비교에서는 의미가 없다. 따라서 구분 기준은 간단하다.

- **유연한 검색** (match, multi_match 등) → Score가 필요 → **must**
- **정확한 검색** (term, terms, range 등) → Score가 불필요 → **filter**

```json
GET /posts/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "검색엔진" } }
      ],
      "filter": [
        { "term": { "category": "자유 게시판" } },
        { "term": { "is_notice": false } }
      ]
    }
  }
}
```

`term`을 `must`에 넣어도 결과 자체는 같지만, Score 계산이 불필요하게 수행되므로 용도에 맞지 않는 사용이다.

### must_not — 특정 조건 제외

`must_not`은 조건을 만족하는 데이터를 결과에서 제외한다. SQL의 `NOT` 또는 `!=`에 대응한다. Score 계산에 관여하지 않는다.

```json
GET /posts/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "검색엔진" } }
      ],
      "must_not": [
        { "term": { "category": "광고 게시판" } },
        { "term": { "is_notice": true } }
      ]
    }
  }
}
```

이 쿼리는 "검색엔진" 키워드와 관련된 글을 찾되, "광고 게시판" 카테고리와 공지글은 결과에서 제외한다. `must_not`에 여러 조건을 넣으면 각각이 독립적으로 적용되어, 어느 하나라도 만족하는 도큐먼트는 제외된다.

### range — 숫자·날짜 범위 조건

숫자나 날짜 데이터에 대해 범위 조건으로 검색할 때 `range` 쿼리를 사용한다. Score와 무관한 조건이므로 `filter`에 배치한다.

| 연산자 | 의미 | SQL 대응 |
| --- | --- | --- |
| `gt` | 초과 | `>` |
| `gte` | 이상 | `>=` |
| `lt` | 미만 | `<` |
| `lte` | 이하 | `<=` |

```json
GET /posts/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "검색엔진" } }
      ],
      "filter": [
        {
          "range": {
            "created_at": {
              "gte": "2026-01-01",
              "lt": "2026-02-01"
            }
          }
        },
        {
          "range": {
            "rating": {
              "gte": 4.0
            }
          }
        }
      ]
    }
  }
}
```

이 쿼리는 "검색엔진" 관련 글 중에서 2026년 1월에 작성되고 평점이 4.0 이상인 도큐먼트만 조회한다. 날짜와 숫자 범위 조건을 조합하는 형태가 실무에서 자주 쓰인다.

### should — 가산점 부여로 상위 노출 제어

`should`는 필수 조건이 아니다. 조건을 만족하지 않는 데이터도 결과에 포함되지만, 만족하는 데이터는 Score에 가산점을 받아 상위에 노출된다. "있으면 좋고, 아니면 말고"의 개념이다.

실무에서 `should`가 쓰이는 대표적인 사례가 쇼핑몰 검색이다. "무선 이어폰"을 검색했을 때 키워드 관련성만으로 정렬하면, 평점이 낮고 좋아요가 적은 상품이 상위에 올 수 있다. 여기에 `should`로 "평점 4.5 이상", "좋아요 100개 이상" 조건을 추가하면, 이 조건을 충족하는 고품질 상품이 가산점을 받아 자연스럽게 상위에 노출된다.

```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "name": "무선 이어폰" } }
      ],
      "filter": [
        { "term": { "category": "이어폰" } }
      ],
      "should": [
        { "range": { "rating": { "gte": 4.5 } } },
        { "range": { "likes": { "gte": 100 } } }
      ]
    }
  }
}
```

`must`와 `filter`로 필수 조건을 걸고, `should`로 평점과 좋아요 수에 가산점을 부여한 형태다. 평점이 4.5 미만이거나 좋아요가 100개 미만인 상품도 결과에 포함되지만, 두 조건을 모두 충족하는 상품이 가장 높은 Score를 받아 상위에 올라간다.

![should 적용 전후 비교](/assets/imgs/posts/개념정리/elastic/11-should-comparison.png)

채용 플랫폼에서 "원격 근무 가능", "연봉 6,000만 원 이상"을 우대하거나, 블로그 검색에서 "최근 작성", "좋아요 수 많은 글"을 우대하는 것도 같은 원리다.

## 자동 완성 기능 — search_as_you_type

검색창에 글자를 입력하는 도중에 실시간으로 결과를 보여주는 자동 완성 기능이 필요한 경우가 있다. Elasticsearch에서는 이를 위한 전용 필드 타입인 `search_as_you_type`을 제공한다.

### 동작 방식

`search_as_you_type`으로 매핑된 필드는 내부적으로 여러 서브 필드를 자동 생성한다.

| 서브 필드 | 역할 |
|---|---|
| `field` | 원본 text와 동일하게 토큰 분리 |
| `field._2gram` | 인접한 2개 토큰 조합 (shingle) |
| `field._3gram` | 인접한 3개 토큰 조합 (shingle) |
| `field._index_prefix` | 각 토큰의 접두사(prefix)를 미리 인덱싱 |

"엘라스틱서치 검색 엔진"이라는 값이 들어가면, `_index_prefix` 서브 필드에는 `[엘, 엘라, 엘라스, ...]` 같은 접두사가 미리 저장된다. 사용자가 "엘라"까지만 입력해도 빠르게 매칭할 수 있는 구조다.

### 매핑 설정

```json
PUT /products
{
  "mappings": {
    "properties": {
      "name": {
        "type": "search_as_you_type"
      }
    }
  }
}
```

### 검색 쿼리

`search_as_you_type` 필드는 `multi_match` 쿼리의 `bool_prefix` 타입과 함께 사용한다. 검색 대상에 서브 필드를 함께 지정해야 한다.

```json
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "엘라스틱",
      "type": "bool_prefix",
      "fields": [
        "name",
        "name._2gram",
        "name._3gram"
      ]
    }
  }
}
```

이 쿼리는 검색어를 토큰으로 분리한 뒤, 마지막 토큰은 prefix 매칭으로, 나머지 토큰은 일반 매칭으로 처리한다. "엘라스틱 검"이라고 입력하면 "엘라스틱"은 정확히 매칭하고 "검"은 접두사로 매칭하여 "검색"이 포함된 도큐먼트를 찾는다.

일반 `match` 쿼리로는 "엘라스틱"까지만 입력했을 때 "엘라스틱서치"를 매칭할 수 없다. `search_as_you_type`은 접두사가 미리 인덱싱되어 있으므로 부분 입력 상태에서도 매칭이 가능하다.

## 페이지네이션과 정렬

### 기본 페이지네이션 — from / size

Elasticsearch에서 페이지네이션은 `from`과 `size` 파라미터로 처리한다. SQL의 `OFFSET`과 `LIMIT`에 대응한다.

```json
GET /posts/_search
{
  "from": 0,
  "size": 10,
  "query": {
    "match": { "title": "검색엔진" }
  }
}
```

| 파라미터 | 역할 | 기본값 |
|---|---|---|
| `from` | 건너뛸 도큐먼트 수 (0부터 시작) | 0 |
| `size` | 가져올 도큐먼트 수 | 10 |

2페이지를 조회하려면 `from: 10, size: 10`, 3페이지는 `from: 20, size: 10`이 된다.

### from / size의 한계 — 깊은 페이지네이션 문제

`from + size`의 기본 상한은 10,000이다 (`index.max_result_window` 설정). `from: 9990, size: 20`처럼 10,000을 넘기면 에러가 발생한다.

이 제한이 존재하는 이유는 Elasticsearch의 분산 구조 때문이다. 인덱스가 5개의 샤드로 구성되어 있고 `from: 1000, size: 10`을 요청하면, 각 샤드에서 상위 1,010개씩 총 5,050개를 코디네이팅 노드로 가져온다. 코디네이팅 노드는 이 5,050개를 다시 정렬한 뒤 1,001~1,010번째를 잘라 반환한다. 페이지가 깊어질수록 각 샤드에서 가져오는 양이 늘어나 메모리와 성능에 부담이 된다.

### search_after — 깊은 페이지네이션의 대안

`from/size` 대신 `search_after`를 사용하면 깊은 페이지에서도 일정한 성능으로 조회할 수 있다. 이전 페이지의 마지막 도큐먼트가 가진 정렬 값을 기준으로 그 다음 도큐먼트부터 가져오는 방식이다.

첫 번째 페이지 요청:

```json
GET /posts/_search
{
  "size": 10,
  "query": {
    "match": { "title": "검색엔진" }
  },
  "sort": [
    { "created_at": "desc" },
    { "_id": "asc" }
  ]
}
```

응답의 마지막 도큐먼트에 포함된 `sort` 값을 확인한 뒤, 다음 페이지 요청에 그 값을 넘긴다:

```json
GET /posts/_search
{
  "size": 10,
  "query": {
    "match": { "title": "검색엔진" }
  },
  "sort": [
    { "created_at": "desc" },
    { "_id": "asc" }
  ],
  "search_after": ["2026-02-15T10:30:00", "abc123"]
}
```

`search_after`는 각 샤드에서 기준 값 이후의 데이터만 가져오므로, 페이지 깊이에 관계없이 일정한 성능을 유지한다. 다만 "3페이지로 바로 이동"같은 랜덤 접근은 불가능하고, 이전/다음 페이지 방식의 순차 탐색만 가능하다.

### 정렬 — sort

Elasticsearch는 기본적으로 Score(관련도 점수) 기준 내림차순으로 결과를 정렬한다. 다른 기준으로 정렬하려면 `sort` 파라미터를 사용한다.

```json
GET /posts/_search
{
  "query": {
    "match": { "title": "검색엔진" }
  },
  "sort": [
    { "created_at": "desc" },
    { "_score": "desc" }
  ]
}
```

이 쿼리는 작성일 기준 내림차순으로 먼저 정렬하고, 같은 날짜 내에서는 Score 순으로 정렬한다.

정렬에 사용하는 필드는 keyword, 숫자, 날짜 타입이어야 한다. text 타입 필드는 토큰으로 분리되어 저장되므로 정렬 기준으로 사용할 수 없다. text 필드로 정렬해야 하는 경우에는 해당 필드에 keyword 서브 필드를 추가하고 `field.keyword`로 정렬한다.

## 요약

| 쿼리 | 용도 | 대상 타입 | bool 배치 |
|---|---|---|---|
| `match` | 키워드 포함 검색 (유연한 검색) | text | `must` |
| `term` / `terms` | 정확한 값 일치 | keyword, long, boolean 등 | `filter` |
| `range` | 숫자/날짜 범위 조건 | integer, long, double, date | `filter` |
| `must_not` | 특정 조건 제외 | 모든 타입 | — |
| `should` | 조건 충족 시 Score 가산점 | 모든 타입 | — |
| `multi_match` (bool_prefix) | 자동 완성 (입력 중 실시간 검색) | search_as_you_type | `must` |
