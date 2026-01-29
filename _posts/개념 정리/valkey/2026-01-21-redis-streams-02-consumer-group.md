---
layout: post
title: "Redis Streams Consumer Group - 메시지 분산 처리"
date: 2026-01-21
categories: [개념정리, valkey]
tags: [redis, streams, consumer-group, valkey]
---

## Consumer Group 개념

Consumer Group은 여러 Consumer가 메시지를 분산 처리하는 메커니즘이다. 같은 그룹 내에서는 한 메시지가 한 Consumer에게만 전달된다.

``` text
Stream: [msg1][msg2][msg3]
         ↓
Consumer Group: email-workers
         ↓
    ┌────┼────┐
    ↓    ↓    ↓
  w1   w2   w3
 msg1 msg2 msg3
```

각 Consumer가 서로 다른 메시지를 받아서 처리하는 구조다.

## Consumer Group 생성: XGROUP CREATE

```bash
XGROUP CREATE orders email-workers 0
```

- `orders`: Stream 이름
- `email-workers`: 그룹 이름
- `0`: 시작 위치 (0은 처음부터, $는 지금부터)

생성된 그룹 정보를 확인할 수 있다.

```bash
XINFO GROUPS orders

# 결과
1) "name": "email-workers"
   "consumers": 0
   "pending": 0
   "last-delivered-id": "0-0"
```

`last-delivered-id`가 `0-0`인 것은 아직 아무 메시지도 전달하지 않았다는 의미다.

## 메시지 읽기: XREADGROUP

Consumer Group으로 메시지를 읽을 때는 `XREADGROUP`을 사용한다.

```bash
XREADGROUP GROUP email-workers worker-1 COUNT 1 STREAMS orders >
```

- `email-workers`: 그룹 이름
- `worker-1`: Consumer 이름
- `COUNT 1`: 1개만 가져오기
- `>`: 아직 전달되지 않은 새 메시지

다른 Consumer가 같은 명령을 실행하면 다른 메시지를 받는다.

```bash
XREADGROUP GROUP email-workers worker-2 COUNT 1 STREAMS orders >
# → 다른 메시지를 받음 (중복 없음)
```

## COUNT 옵션의 중요성

COUNT 없이 읽으면 한 Consumer가 모든 메시지를 가져가는 문제가 있었다.

```bash
XREADGROUP GROUP workers worker-1 STREAMS orders >
# → 5개 전부 가져감

XREADGROUP GROUP workers worker-2 STREAMS orders >
# → 받을 게 없음
```

COUNT를 사용하면 메시지가 공평하게 분산된다.

```bash
XREADGROUP GROUP workers worker-1 COUNT 1 STREAMS orders >
# → msg1

XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS orders >
# → msg2

XREADGROUP GROUP workers worker-3 COUNT 1 STREAMS orders >
# → msg3
```

실제 운영에서는 COUNT를 적절히 설정해서 각 Consumer가 처리할 수 있는 만큼만 가져가도록 해야 한다.

## ACK와 Pending

메시지를 읽은 후 처리가 완료되면 ACK를 보내야 한다.

```bash
XACK orders workers <message-id>
```

ACK를 하지 않으면 메시지가 Pending 상태로 남는다. Pending 메시지는 처리 중이거나 실패한 메시지를 의미한다.

### Pending 조회

간단 조회:

```bash
XPENDING orders workers

# 결과
1) (integer) 3          # 3개 Pending
2) "1737...-0"          # 첫 Pending ID
3) "1737...-2"          # 마지막 Pending ID
4) 1) "worker-1": "1"   # worker-1이 1개
   2) "worker-2": "1"
   3) "worker-3": "1"
```

상세 조회:

```bash
XPENDING orders workers - + 10

# 결과
1) 1) "1737...-0"        # 메시지 ID
   2) "worker-1"         # 누가 받았는지
   3) (integer) 15000    # 15초 전에 받음 (idle time)
   4) (integer) 1        # 전달 횟수
```

idle time과 전달 횟수를 보면 문제가 있는 메시지를 파악할 수 있다.

## 그룹 간 독립성

같은 그룹 내 Consumer끼리는 메시지가 분산되지만, 다른 그룹은 독립적으로 모든 메시지를 받는다.

```bash
# 그룹 A
XGROUP CREATE orders group-a 0
XREADGROUP GROUP group-a c1 STREAMS orders >
# → msg1, 2, 3 받음

# 그룹 B
XGROUP CREATE orders group-b 0
XREADGROUP GROUP group-b c1 STREAMS orders >
# → msg1, 2, 3 다시 받음 (독립적)
```

Kafka의 Consumer Group과 동일한 개념이다. 같은 메시지를 여러 용도로 처리해야 할 때 각각 그룹을 만들면 된다.

## ">" vs "0"

`XREADGROUP`의 마지막 인자는 두 가지 의미를 가진다.

- `>`: 아직 전달되지 않은 새 메시지
- `0`: 이미 받았지만 ACK하지 않은 Pending 메시지

Pending 메시지를 재처리하려면 `0`을 사용한다.

```bash
XREADGROUP GROUP workers worker-1 STREAMS orders 0
# → ACK 안 한 메시지 반환
```

Consumer가 재시작되거나 처리 실패 후 재시도할 때 유용하다.

## Pending 메시지 재할당: XCLAIM

특정 Consumer가 죽어서 Pending 메시지를 처리하지 못하는 경우, 다른 Consumer에게 넘길 수 있다.

```bash
XCLAIM orders workers worker-2 10000 <msg-id>
```

- `worker-2`: 새로운 담당 Consumer
- `10000`: 10초(10000ms) 이상 Pending된 것만 대상

오래된 Pending 메시지만 가져가도록 시간 조건을 걸 수 있다.

## Consumer 정보 조회

그룹 내 Consumer들의 상태를 확인할 수 있다.

```bash
XINFO CONSUMERS orders workers

# 결과
1) "name": "worker-1"
   "pending": 2
   "idle": 15000    # 15초 전에 마지막으로 읽음
```

`idle` 값이 너무 크면 해당 Consumer가 정상 동작하지 않는 것일 수 있다.

## 정리

Consumer Group의 핵심 개념은 다음과 같다.

1. 같은 그룹 내에서는 메시지가 Consumer들에게 분산된다
2. 다른 그룹은 독립적으로 모든 메시지를 받는다
3. ACK를 보내지 않으면 Pending 상태로 남아서 재처리할 수 있다
4. `>`는 새 메시지, `0`은 Pending 메시지를 읽는다
5. `XCLAIM`으로 Pending 메시지를 다른 Consumer에게 넘길 수 있다

다음에는 Offset과 메시지 진행 상태 관리에 대해 정리할 예정이다.
