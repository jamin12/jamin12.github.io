---
layout: post
title: "Redis Streams Offset - 메시지 진행 상태 관리"
date: 2026-01-21
categories: [개념정리, valkey]
tags: [redis, streams, offset, valkey]
---

## Offset 개념

Consumer Group은 `last-delivered-id` 필드로 어디까지 메시지를 전달했는지 기록한다. 이것이 Offset에 해당한다.

테스트를 위해 메시지 5개를 추가했다.

```bash
DEL mybook
XADD mybook * chapter 1 title "시작"
XADD mybook * chapter 2 title "모험"
XADD mybook * chapter 3 title "위기"
XADD mybook * chapter 4 title "극복"
XADD mybook * chapter 5 title "결말"

XGROUP CREATE mybook readers 0
```

초기 상태

```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "0-0"
```

아직 아무 메시지도 전달하지 않았기 때문에 `0-0`이다.

reader-1이 메시지 1개를 읽었다.

```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 1

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-0"
```

Offset이 chapter 1의 ID로 업데이트됐다.

## ">"의 정확한 의미

`XREADGROUP`에서 `>`는 `last-delivered-id` 다음부터 읽겠다는 의미다.

``` text
Stream: [ch1][ch2][ch3][ch4][ch5]
              ↑
       last-delivered-id = ch2

다음 ">" 요청 시: ch3부터 전달
```

chapter 2까지 읽은 상태에서 다시 읽으면 chapter 3을 받는다.

```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 3 (chapter 1, 2가 아님)
```

## Offset과 Pending의 차이

```bash
DEL mybook
XADD mybook * chapter 1
XADD mybook * chapter 2
XADD mybook * chapter 3
XGROUP CREATE mybook readers 0

# 3개 모두 읽기 (ACK 안 함)
XREADGROUP GROUP readers reader-1 STREAMS mybook >
```

상태를 확인했다.

```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "1737...-2"
"pending": 3
```

- Offset (`last-delivered-id`): chapter 3까지 전달했다
- Pending: 3개가 ACK 대기 중이다

chapter 1만 ACK를 보냈다.

```bash
XACK mybook readers <chapter-1-id>

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-2"  # 변화 없음
"pending": 2
```

**ACK는 Pending에만 영향을 주고, Offset은 변하지 않았다.**

| 개념 | 의미 | ACK 영향 |
|------|------|----------|
| Offset | 어디까지 전달했는지 | 영향 없음 |
| Pending | 어느 것을 ACK 안 받았는지 | ACK하면 감소 |

## Consumer별 Offset은 없다

중요한 점을 발견했다. Offset은 Consumer 개별이 아니라 **Group 전체가 공유**한다.

```bash
DEL test
XADD test * msg 1
XADD test * msg 2
XADD test * msg 3
XADD test * msg 4

XGROUP CREATE test workers 0

# worker-1이 2개 읽기
XREADGROUP GROUP workers worker-1 COUNT 2 STREAMS test >
# → msg 1, 2

XINFO GROUPS test
# 결과: "last-delivered-id": "...-1"  (msg 2 ID)

# worker-2가 읽기
XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS test >
# → msg 3 (msg 1, 2가 아님!)
```

worker-2는 msg 1, 2를 한 번도 받은 적이 없지만, 그룹의 Offset이 msg 2까지 진행되어 있어서 msg 3을 받았다.

정리하면:
- **Offset**: 그룹 단위
- **Pending**: Consumer 단위

## Offset 재설정

`XGROUP SETID`로 Offset을 이동시킬 수 있다. 재처리가 필요할 때 유용하다.

```bash
DEL mybook
XADD mybook * chapter 1
XADD mybook * chapter 2
XADD mybook * chapter 3
XADD mybook * chapter 4
XADD mybook * chapter 5

XGROUP CREATE mybook readers 0

# chapter 3까지 읽음
XREADGROUP GROUP readers r1 COUNT 3 STREAMS mybook >

# chapter 1 ID 확인
XRANGE mybook - + COUNT 1
# → "1737...-0"

# Offset 재설정 (chapter 1 ID로)
XGROUP SETID mybook readers 1737...-0

# 다시 읽기
XREADGROUP GROUP readers r1 COUNT 1 STREAMS mybook >
# → chapter 2 (chapter 1 다음부터)
```

## ACK와 메시지 보관

ACK를 해도 메시지는 Stream에 그대로 남는다는 점도 확인했다.

```bash
DEL orders
XADD orders * orderId 123
XADD orders * orderId 456
XADD orders * orderId 789

XGROUP CREATE orders workers 0

# 메시지 읽고 ACK
XREADGROUP GROUP workers worker-1 COUNT 1 STREAMS orders >
XACK orders workers <msg-id>

# Pending 확인
XPENDING orders workers
# → 0개

# Stream 확인
XRANGE orders - +
# → orderId:123, 456, 789 모두 존재
```

ACK는 Pending 목록에서만 제거한다. 메시지 자체는 삭제되지 않는다.

덕분에 다른 그룹이 같은 메시지를 읽을 수 있다.

```bash
XGROUP CREATE orders analytics 0
XREADGROUP GROUP analytics a1 COUNT 1 STREAMS orders >
# → orderId:123 (workers 그룹이 ACK한 메시지)
```

## 정리

Offset과 Pending의 관계를 정리하면 다음과 같다.

1. **Offset** (`last-delivered-id`)은 그룹이 어디까지 메시지를 전달했는지 기록한다
2. **Pending**은 전달되었지만 ACK되지 않은 메시지를 기록한다
3. ACK는 Pending에만 영향을 주고, Offset은 변하지 않는다
4. Offset은 그룹 전체가 공유하고, Pending은 Consumer별로 관리된다
5. 메시지는 ACK 후에도 Stream에 남아서 다른 그룹이 읽을 수 있다
