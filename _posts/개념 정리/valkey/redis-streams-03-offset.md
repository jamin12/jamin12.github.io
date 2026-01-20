# Offset과 메시지 진행 상태 관리

## Offset의 개념

Consumer Group은 `last-delivered-id` 필드로 "어디까지 읽었는지"를 기록한다. 이것이 Offset이다.

Stream에 메시지 5개를 추가한다.

```bash
DEL mybook
XADD mybook * chapter 1 title "시작"
XADD mybook * chapter 2 title "모험"
XADD mybook * chapter 3 title "위기"
XADD mybook * chapter 4 title "극복"
XADD mybook * chapter 5 title "결말"

XGROUP CREATE mybook readers 0
```

초기 상태:

```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "0-0"  # 아직 전달 안 함
```

reader-1이 1개 메시지를 읽는다.

```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 1

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-0"  # chapter 1 ID
```

한 번 더 읽는다.

```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 2

# Offset이 chapter 2 ID로 업데이트됨
```

## ">" 의 정확한 의미

`XREADGROUP`에서 `>`는 "last-delivered-id 다음부터"를 의미한다.

```
Stream: [ch1][ch2][ch3][ch4][ch5]
              ↑
       last-delivered-id = ch2

다음 ">" 요청 시: ch3부터 전달
```

```bash
# 현재 Offset = chapter 2

XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 3 받음 (chapter 1, 2가 아님)
```

## Offset과 Pending의 차이

Offset과 Pending은 다른 개념이다.

```bash
DEL mybook
XADD mybook * chapter 1
XADD mybook * chapter 2
XADD mybook * chapter 3
XGROUP CREATE mybook readers 0

# 3개 모두 읽기 (ACK 안 함)
XREADGROUP GROUP readers reader-1 STREAMS mybook >
```

상태 확인:

```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "1737...-2"  # chapter 3 ID
"pending": 3
```

- Offset: chapter 3까지 전달했다
- Pending: 3개가 ACK 대기 중이다

chapter 1만 ACK를 보낸다.

```bash
XACK mybook readers <chapter-1-id>

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-2"  # 변화 없음
"pending": 2  # 줄어듦
```

Offset은 변하지 않는다. ACK는 Pending에만 영향을 준다.

정리:

- Offset (last-delivered-id): 어디까지 전달했는지
- Pending: 어느 것을 ACK 안 받았는지

## ReadOffset의 종류

Spring Data Redis에서 사용하는 ReadOffset 타입이다.

### lastConsumed() - ">"

```bash
XREADGROUP ... STREAMS mystream >
```

Offset 다음부터 읽는다. 가장 일반적인 사용 방식이다.

### latest() - "$"

```bash
XREADGROUP ... STREAMS mystream $
```

지금부터 새로 들어오는 메시지만 읽는다. 과거 메시지는 무시한다.

```bash
DEL test
XADD test * msg 1
XADD test * msg 2
XADD test * msg 3

XGROUP CREATE test group1 0

XREADGROUP GROUP group1 c1 STREAMS test $
# → 비어있음 (기존 메시지 무시)

# 새 메시지 추가
XADD test * msg 4

XREADGROUP GROUP group1 c1 STREAMS test $
# → msg 4만 받음
```

실시간 알림 같은 경우에 유용하다.

### from(messageId)

특정 ID 이후부터 읽는다.

```bash
XREADGROUP ... STREAMS mystream <specific-id>
```

재처리가 필요한 경우 사용할 수 있다.

## Offset 재설정

`XGROUP SETID`로 Offset을 이동시킬 수 있다.

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
# Offset = chapter 3

# chapter 1 ID 확인
XRANGE mybook - + COUNT 1
# → "1737...-0"

# Offset 재설정
XGROUP SETID mybook readers 1737...-0

# 다시 읽기
XREADGROUP GROUP readers r1 COUNT 1 STREAMS mybook >
# → chapter 2 (chapter 1 다음부터)
```

## Consumer별로는 Offset이 없다

Offset은 Consumer 개별이 아니라 Consumer Group 전체가 공유한다.

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

# Offset 확인
XINFO GROUPS test
# 결과: "last-delivered-id": "...-1"  # msg 2 ID

# worker-2가 읽기
XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS test >
# → msg 3 (msg 1, 2가 아님!)
```

worker-2는 msg 1, 2를 받지 않았지만, 그룹의 Offset이 msg 2까지 진행되어 있어서 msg 3을 받는다.

Offset은 그룹 단위로 관리되고, Pending은 Consumer 단위로 관리된다.

## ACK와 메시지 보관

ACK를 해도 메시지는 Stream에 그대로 남는다.

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

다른 그룹이 같은 메시지를 읽을 수 있다.

```bash
XGROUP CREATE orders analytics 0
XREADGROUP GROUP analytics a1 COUNT 1 STREAMS orders >
# → orderId:123 (workers 그룹이 ACK한 메시지)
```

## 관찰

Offset은 Consumer Group이 어디까지 메시지를 전달했는지 기록한다.

- Offset (last-delivered-id): 전달 여부
- Pending: ACK 대기 여부
- ACK는 Offset에 영향을 주지 않는다
- Offset은 그룹 전체가 공유한다
- 메시지는 ACK 후에도 Stream에 남는다

여러 서비스가 같은 이벤트를 독립적으로 소비할 수 있다. 메시지가 보관되므로 나중에 추가된 서비스도 과거 이벤트를 처리할 수 있다.
