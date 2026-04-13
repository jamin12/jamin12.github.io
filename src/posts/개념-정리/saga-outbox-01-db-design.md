---
title: "Saga + Outbox 패턴 (1) — DB 설계: 왜 테이블 4개인가"
date: 2026-04-12
tags: [saga, outbox, 분산-트랜잭션, msa, 멱등성]
---

## 1. 출발점 — 테이블 2개

처음에는 두 테이블로 시작했다.

- **발행 테이블**: 이벤트 ID, 발행 여부(미발행/발행/완료), 생성시간, 완료시점
- **이벤트 테이블**: 이벤트 ID, 현재 스텝, payload, 진행여부(미진행/진행중/종료)

브로커에는 이벤트 ID만 보내고, 컨슈머가 이벤트 테이블에서 payload를 꺼내 쓰면 중복 저장 없이 깔끔할 것 같았다. 같은 서비스 내부에서 Outbox → 브로커 → 같은 DB에 접근 가능한 구조라면 이 방식이 유효하다.

하지만 다른 서비스(다른 DB)가 컨슈머가 되면 이벤트 테이블을 읽을 수 없다. 그때는 payload를 메시지 자체에 포함해야 한다. 당장은 아니더라도 확장 가능성을 인지해야 한다.

### 테이블 하나로 합치면 안 되나?

Outbox 하나에 발행 추적과 워크플로우 추적을 전부 넣으면 되지 않을까 싶었다. 하지만 베스트 프랙티스를 찾아보니 분리해야 하는 명확한 이유가 있었다.

| 관점 | 이유 |
|------|------|
| 단일 책임 | Outbox = 발행 보장, Saga State = 워크플로우 추적 |
| CDC 호환 | Debezium은 Outbox 테이블만 감시하면 됨 |
| 생명주기 | Outbox 행은 발행 후 삭제/마킹, Saga 행은 완료까지 유지 |
| 성능 | Outbox는 빠르게 비워지고, Saga는 상태 업데이트 위주 |

처음 2개로 나누자고 한 직감이 맞았다. 다만 역할 분리의 이유를 정확히 알게 됐다.

### 최종 구조 — 테이블 4개

논의를 거치며 2개가 4개로 늘었다. 추가된 2개는 각각 구체적인 문제에서 비롯됐다.

| 테이블 | 추가 계기 |
|--------|-------------|
| Outbox | 처음부터 있었음. 발행 책임. |
| Saga State | 처음부터 있었음. 워크플로우 추적. |
| Step Log | Saga State에 에러 컬럼만 두면 보상 중 에러가 원본 에러를 덮어쓰는 문제가 생겨서 추가. |
| Processed Event | 메시지 중복 수신 시 재처리를 방지할 멱등성 체크가 필요해서 추가. |

서비스가 발행자이자 소비자라면 4개 테이블 전부 필요하다.

``` text
모든 서비스
├── Outbox           ← 항상 필요 (요청 발행 + 응답 발행)
├── Saga State       ← 내가 시작한 Saga용
├── Saga Step Log    ← Saga 이력
└── Processed Event  ← 남이 시킨 일 중복 방지
```

---

## 2. Outbox 테이블 (발행 책임)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK (매번 새로 생성) |
| saga_id | UUID | 어떤 Saga인지 |
| aggregate_type | VARCHAR | 도메인 객체 타입 (ORDER, MEMBER 등) |
| aggregate_id | VARCHAR | 도메인 객체 ID |
| event_type | VARCHAR | 이벤트 종류 (PAYMENT_REQUEST 등) |
| payload | JSONB | 브로커에 보낼 데이터 |
| status | VARCHAR | PENDING / PUBLISHED |
| retry_count | INT | 브로커 발행 실패 재시도 횟수 |
| max_retries | INT | 최대 재시도 횟수 |
| error_message | TEXT | 발행 실패 시 에러 |
| created_at | TIMESTAMP | 생성시간 |
| published_at | TIMESTAMP | 발행시점 |

INSERT로 계속 쌓이는 일회용 발행 요청서다. 재사용하지 않는다. PUBLISHED된 지 N일 지난 행은 배치 삭제 또는 파티셔닝으로 정리해야 한다.

### aggregate_type / aggregate_id

필수는 아니고 **운영 편의성**을 위한 컬럼이다. 디버깅이나 모니터링 시 "이게 뭐에 대한 이벤트지?" 파악 용도다.

- aggregate_type = 어떤 도메인인지 (ORDER, MEMBER 등)
- aggregate_id = 그 도메인의 구체적인 ID (order-123, member-456 등)

### event_type과 Saga State의 current_step

얼핏 겹치는 것처럼 보이지만 **보는 주체가 다르다**.

| | Saga State current_step | Outbox event_type |
|--|------------------------|-------------------|
| 보는 주체 | 오케스트레이터 (자기 DB) | 컨슈머 (다른 서비스, DB 접근 불가) |
| 용도 | "지금 어디까지 왔지?" | "나한테 뭘 시키는 거지?" |

컨슈머는 오케스트레이터의 DB(Saga State)를 볼 수 없으니 메시지의 event_type으로 판단해야 한다.

---

## 3. Saga State 테이블 (워크플로우 책임)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| saga_id | UUID | PK |
| saga_type | VARCHAR | Saga 종류 |
| current_step | VARCHAR | 현재 스텝 |
| saga_data | JSONB | 전체 컨텍스트 데이터 (Step 이름 기준 키로 누적) |
| status | VARCHAR | STARTED / SUCCEEDED / ABORTING / ABORTED / COMPENSATION_FAILED |
| retry_count | INT | Step 응답 타임아웃 재시도 횟수 |
| max_retries | INT | 최대 재시도 |
| step_requested_at | TIMESTAMP | 현재 Step 요청 시점 |
| step_timeout_ms | BIGINT | Step 타임아웃 |
| version | INT | 낙관적 락 |
| created_at | TIMESTAMP | 생성시간 |
| updated_at | TIMESTAMP | 마지막 상태 변경 |

saga_id 1행을 계속 UPDATE하는 방식이다.

### INSERT vs UPDATE

Saga State 자체를 INSERT로 쌓으면 이력도 남고 Step Log 테이블이 필요 없지 않을까 싶었다. 하지만 UPDATE가 낫다.

- 현재 상태 조회 시 매번 `ORDER BY created_at DESC LIMIT 1` 필요
- saga_data를 매 행마다 복사해야 하는 중복
- 타임아웃 스케줄러가 "진행 중인 Saga" 찾으려면 서브쿼리 필요
- Step Log는 가볍게 INSERT만 하면 되고, 역할이 다르니까 분리가 나음

### saga_data의 누적 구조

saga_data는 덮어쓰기가 아니라 **누적**이다. Step 이름을 키로 사용한다.

```json
{
  "PAYMENT_REQUEST": {
    "paymentId": "pay-456",
    "approvalNo": "AP-789"
  },
  "INVENTORY_REQUEST": {
    "reservationId": "rsv-101"
  }
}
```

Step 이름으로 키를 나누면 키 충돌이 없고, 보상 시 어떤 Step 데이터인지 바로 알 수 있으며, 복합 클래스도 JSON으로 유연하게 담을 수 있다.

### Outbox payload와 saga_data의 차이

| | Outbox payload | Saga State saga_data |
|--|---------------|---------------------|
| 내용 | 지금 이 Step 전달용 메시지 | Saga 전체 컨텍스트 (누적) |
| 수명 | 발행되면 끝 | Saga 끝날 때까지 유지 |
| 용도 | 브로커에 보낼 데이터 | 보상 시 원본 데이터 복원 |

**Outbox는 택배 송장, Saga State는 작업 일지.**

---

## 4. Saga Step Log 테이블 (이력)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT | PK |
| saga_id | UUID | FK |
| step_name | VARCHAR | Step 이름 |
| step_number | INT | Step 번호 |
| status | VARCHAR | STARTED / COMPLETED / FAILED |
| error_message | TEXT | 실패 시 에러 메시지 |
| duration_ms | BIGINT | 소요시간 |
| created_at | TIMESTAMP | 기록시점 |

### 왜 필요한가 — 에러 덮어쓰기 문제

Saga State에 error_message 컬럼 하나만 두면 이런 문제가 생긴다.

```
Step 3 실패: error_message = "재고 부족"
  → 보상 시작
Step 2 보상 실패: error_message = "결제 취소 타임아웃"  ← 덮어씌워짐
  → "재고 부족"은 사라짐
```

Step Log가 있으면 모든 이력이 남아서 덮어쓰기 문제가 없다.

### 실패만 기록해도 되지 않나?

동작은 하지만 한계가 있다. "어디까지 성공했지?"를 current_step으로 추론해야 하고, Step별 소요시간이나 병목 분석 같은 모니터링이 불가능하다. 전부 기록하는 것을 권장한다. 데이터량이 걱정이면 성공 로그만 일정 기간 후 삭제하면 된다.

---

## 5. Processed Event 테이블 (멱등성 체크)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| saga_id | UUID | PK (복합) |
| step | VARCHAR | PK (복합) |

### 왜 필요한가

Saga State는 오케스트레이터 서비스에만 있다. 참여자는 Saga State를 볼 수 없으니 "이 메시지를 이미 처리했는지" 체크할 방법이 없다. 그래서 가벼운 이력 테이블이 필요하다.

``` text
메시지 수신 → saga_id + step 조회
  ├─ 이미 있음 → skip, 결과만 다시 응답
  └─ 없음     → 처리 + INSERT (같은 TX)
```

### 서버 다운 시 정합성

비즈니스 로직 + Processed Event INSERT + Outbox INSERT를 같은 트랜잭션으로 묶으면 문제없다.

- **COMMIT 전 서버 다운** → 전부 롤백 → 재시도 시 처음부터 정상 처리
- **COMMIT 후 ACK 전 서버 다운** → 이미 처리됨 → 재시도 시 멱등성으로 skip + Outbox 응답은 이미 INSERT됐으니 Poller가 발행

### 멱등성 확보의 두 가지 방법

1. **Processed Event 테이블**: 대부분의 경우 안전한 범용 방법
2. **비즈니스 로직 자체가 멱등**: "재고 10개로 세팅"은 몇 번 해도 결과가 같다(멱등). 반면 "재고 1개 차감"은 중복이면 2개가 차감된다(멱등 아님). 후자는 이력 테이블이 필요하다.
