# Consumer Group

## Consumer Group 개념

Consumer Group은 여러 Consumer가 메시지를 나눠서 처리하도록 하는 메커니즘이다. 같은 그룹 내에서는 한 메시지가 한 Consumer에게만 전달된다.

```
Stream: [msg1][msg2][msg3]
         ↓
Consumer Group: email-workers
         ↓
    ┌────┼────┐
    ↓    ↓    ↓
  w1   w2   w3
 msg1 msg2 msg3
```

## Consumer Group 생성 (XGROUP CREATE)

```bash
XGROUP CREATE orders email-workers 0
```

- `orders`: Stream 이름
- `email-workers`: 그룹 이름
- `0`: 시작 위치 (0=처음부터, $=지금부터)

그룹 정보 조회:

```bash
XINFO GROUPS orders

# 결과
1) "name": "email-workers"
   "consumers": 0
   "pending": 0
   "last-delivered-id": "0-0"
```

## 메시지 읽기 (XREADGROUP)

```bash
XREADGROUP GROUP email-workers worker-1 COUNT 1 STREAMS orders >
```

- `email-workers`: 그룹 이름
- `worker-1`: Consumer 이름
- `COUNT 1`: 1개만 가져오기
- `>`: 아직 전달 안 된 메시지

다른 Consumer가 읽기:

```bash
XREADGROUP GROUP email-workers worker-2 COUNT 1 STREAMS orders >
# → 다른 메시지를 받음 (중복 없음)
```

## COUNT의 중요성

COUNT 없이 읽으면 한 Consumer가 모든 메시지를 가져간다:

```bash
XREADGROUP GROUP workers worker-1 STREAMS orders >
# → 5개 전부 가져감

XREADGROUP GROUP workers worker-2 STREAMS orders >
# → 받을 게 없음
```

COUNT를 사용하면 공평하게 분산된다:

```bash
XREADGROUP GROUP workers worker-1 COUNT 1 STREAMS orders >
# → msg1

XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS orders >
# → msg2

XREADGROUP GROUP workers worker-3 COUNT 1 STREAMS orders >
# → msg3
```

## ACK (처리 완료)

```bash
XACK orders workers <message-id>
```

ACK를 하지 않으면 메시지가 "Pending" 상태로 남는다.

### Pending 조회

```bash
# 간단 조회
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
   3) (integer) 15000    # 15초 전에 받음
   4) (integer) 1        # 전달 횟수
```

## Consumer Group 독립성

각 그룹은 독립적으로 메시지를 읽는다:

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

## ">" vs "0"

- `>`: 아직 전달 안 된 새 메시지
- `0`: 이미 받았지만 ACK 안 한 Pending 메시지

Pending 메시지 재처리:

```bash
# Pending 메시지 다시 읽기
XREADGROUP GROUP workers worker-1 STREAMS orders 0
# → ACK 안 한 메시지 반환
```

## Pending 메시지 재할당 (XCLAIM)

다른 Consumer에게 Pending 메시지를 넘길 수 있다:

```bash
XCLAIM orders workers worker-2 10000 <msg-id>
```

- `worker-2`: 새 주인
- `10000`: 10초 이상 Pending된 것만

## Consumer 정보 조회

```bash
XINFO CONSUMERS orders workers

# 결과
1) "name": "worker-1"
   "pending": 2
   "idle": 15000    # 15초 전에 마지막으로 읽음
```
