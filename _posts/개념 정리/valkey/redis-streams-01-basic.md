# Redis Streams 기초

## Stream 개념

Redis Streams는 append-only 로그 구조다. 메시지가 시간 순서대로 쌓이며, 명시적으로 삭제하지 않는 한 보관된다.

```
Stream "orders"
┌─────────────────────────────────────┐
│ 1737284567890-0 | order:123, $100  │
│ 1737284567891-0 | order:456, $200  │
│ 1737284567892-0 | order:789, $300  │
└─────────────────────────────────────┘
```

## 메시지 추가 (XADD)

```bash
XADD orders * orderId 123 amount 10000 status pending
# → "1737284567890-0"
```

- `orders`: Stream 이름 (없으면 자동 생성)
- `*`: ID 자동 생성
- `orderId 123 amount 10000`: 필드-값 쌍

### 메시지 ID 구조

```
1737284567890-0
└─────┬──────┘ │
   timestamp   sequence
```

- 앞부분: 밀리초 단위 Unix timestamp
- 뒷부분: 같은 시간 내 순번

## 메시지 조회 (XRANGE)

```bash
# 전체 조회
XRANGE orders - +

# 결과
1) 1) "1737284567890-0"
   2) 1) "orderId"
      2) "123"
      3) "amount"
      4) "10000"
```

특정 ID 이후만 조회:

```bash
XRANGE orders 1737284567890-0 +
# → orderId:456, 789만 반환
```

개수 제한:

```bash
XRANGE orders - + COUNT 2
# → 처음 2개만
```

## Stream 정보 조회

```bash
# Stream 길이
XLEN orders
# → 3

# Stream 정보
XINFO STREAM orders
```

## 실시간 읽기 (XREAD)

```bash
# 처음부터 읽기
XREAD STREAMS orders 0

# 지금부터 새로운 것만 (BLOCK 5초)
XREAD BLOCK 5000 STREAMS orders $
```

시작 위치:
- `0`: 처음부터 모든 메시지
- `$`: 지금부터 새로운 것만
- `<특정 ID>`: 해당 ID 다음부터

## 여러 Stream 동시 읽기

```bash
XREAD STREAMS orders payments notifications 0 0 0
# → 3개 Stream의 메시지 모두 반환
```

## XRANGE vs XREAD

- `XRANGE`: 과거 메시지 조회 (히스토리)
- `XREAD`: 실시간 메시지 대기 (polling)
