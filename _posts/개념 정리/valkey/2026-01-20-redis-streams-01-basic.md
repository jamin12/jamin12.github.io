---
layout: post
title: "Redis Streams 기초 - 메시지 추가와 조회"
date: 2026-01-20
categories: [개념정리, valkey]
tags: [redis, streams, valkey]
---

## Stream 구조

Redis Streams는 append-only 로그 구조다. 메시지가 시간 순서대로 쌓이며, 명시적으로 삭제하지 않는 한 보관된다.

``` text
Stream "orders"
┌─────────────────────────────────────┐
│ 1737284567890-0 | order:123, $100  │
│ 1737284567891-0 | order:456, $200  │
│ 1737284567892-0 | order:789, $300  │
└─────────────────────────────────────┘
```

각 메시지는 고유한 ID를 가진다. ID는 자동으로 생성되거나 명시적으로 지정할 수 있다.

## 메시지 추가: XADD

메시지를 추가할 때는 `XADD` 명령어를 사용한다.

```bash
XADD orders * orderId 123 amount 10000 status pending
# → "1737284567890-0"
```

- `orders`: Stream 이름이다. 없으면 자동으로 생성된다.
- `*`: ID 자동 생성을 의미한다. 특정 ID를 직접 지정할 수도 있다.
- `orderId 123 amount 10000`: 필드-값 쌍이다. 여러 개를 넣을 수 있다.

### 메시지 ID 구조

반환된 ID의 구조가 궁금해서 확인해봤다.

```
1737284567890-0
└─────┬──────┘ │
   timestamp   sequence
```

앞부분은 밀리초 단위 Unix timestamp이고, 뒷부분은 같은 밀리초 내에서의 순번이다. 동시에 여러 메시지가 추가되면 sequence가 증가한다.

## 메시지 조회: XRANGE

저장된 메시지를 조회할 때는 `XRANGE`를 사용한다.

```bash
XRANGE orders - +

# 결과
1) 1) "1737284567890-0"
   2) 1) "orderId"
      2) "123"
      3) "amount"
      4) "10000"
      5) "status"
      6) "pending"
```

`-`는 가장 작은 ID(처음), `+`는 가장 큰 ID(끝)를 의미한다.

특정 ID 이후만 조회하려면 시작 ID를 지정하면 된다.

```bash
XRANGE orders 1737284567890-0 +
# → orderId:456, 789만 반환
```

개수를 제한하려면 `COUNT` 옵션을 사용한다.

```bash
XRANGE orders - + COUNT 2
# → 처음 2개만
```

## 실시간 읽기: XREAD

`XREAD`는 실시간으로 메시지를 대기하면서 읽을 때 사용한다.

```bash
# 처음부터 읽기
XREAD STREAMS orders 0

# 지금부터 새로운 것만 (BLOCK 5초)
XREAD BLOCK 5000 STREAMS orders $
```

시작 위치를 지정하는 방법은 세 가지다.

- `0`: 처음부터 모든 메시지
- `$`: 지금부터 새로 들어오는 것만
- `<특정 ID>`: 해당 ID 다음부터

여러 Stream을 동시에 읽을 수도 있다.

```bash
XREAD STREAMS orders payments notifications 0 0 0
# → 3개 Stream의 메시지 모두 반환
```

## XRANGE와 XREAD 차이

두 명령어의 용도가 다르다는 점을 정리했다.

| 명령어   | 용도                          | 특징                                              |
|----------|-------------------------------|---------------------------------------------------|
| XRANGE   | 과거 메시지 조회 (히스토리)   | 특정 범위 지정 가능, 동기 방식                    |
| XREAD    | 실시간 메시지 대기 (polling)  | BLOCK 옵션으로 대기 가능, 여러 Stream 동시 감시   |

`XRANGE`는 이미 저장된 메시지를 범위로 가져올 때, `XREAD`는 새로운 메시지가 들어올 때까지 대기하면서 읽을 때 사용한다.

## Stream 정보 조회

Stream의 상태를 확인하는 명령어도 있다.

```bash
# Stream 길이
XLEN orders
# → 3

# Stream 상세 정보
XINFO STREAM orders
```

`XINFO STREAM`은 다음 정보를 제공한다.

- length: 메시지 개수
- first-entry: 첫 메시지
- last-entry: 마지막 메시지
- groups: Consumer Group 개수

## 정리

Redis Streams의 기본 구조는 다음과 같다.

1. append-only 로그 구조로, 메시지가 시간 순서대로 쌓인다
2. 각 메시지는 timestamp-sequence 형식의 고유 ID를 가진다
3. `XADD`로 메시지를 추가하고, `XRANGE`로 과거 메시지를 조회한다
4. `XREAD`는 BLOCK 옵션과 함께 실시간 polling에 사용한다
