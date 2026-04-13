---
title: "Saga + Outbox 패턴 (2) — Status, 재시도, 보상 트랜잭션"
date: 2026-04-12
tags: [saga, outbox, 분산-트랜잭션, msa, 보상-트랜잭션]
---

## 1. Status 흐름

``` text
STARTED
  ├─ 모든 Step 성공 → SUCCEEDED
  └─ Step 실패 or 타임아웃 초과
       │
    ABORTING (보상 중)
       ├─ 보상 성공 → ABORTED
       └─ 보상 실패 → COMPENSATION_FAILED → 수동 개입 (알림)
```

---

## 2. 재시도 메커니즘

### 두 레벨의 재시도

재시도를 Outbox가 전부 담당하는 줄 알았는데, 실제로는 두 레벨이 존재한다.

| 레벨 | 테이블 | 대상 |
|------|--------|------|
| 발행 재시도 | Outbox retry_count | 브로커에 못 보냈을 때 |
| Step 재시도 | Saga State retry_count | 보냈는데 응답이 안 올 때 |

재시도 **판단**은 Saga State가 하고, 실제 **발행**은 항상 Outbox를 통한다.

``` text
Saga State: "응답 안 왔네, retry_count++ 하고 재발행하자" (판단)
Outbox:     "새 이벤트 왔네, 브로커에 보내자" (실행)
```

### 재발행은 새 행을 INSERT하는 것

기존 Outbox 행을 재사용하는 게 아니다. 매번 새 행을 INSERT한다.

``` text
1차: Outbox id=AAA, PENDING → PUBLISHED (역할 끝)
  ... 타임아웃 ...
2차: Outbox id=BBB (새 행), PENDING → PUBLISHED
  ... 또 타임아웃 ...
3차: Outbox id=CCC (새 행), PENDING → PUBLISHED
  ... 또 타임아웃 ...
Saga: retry_count >= max_retries → ABORTING
```

### 타임아웃 재발행 흐름

``` text
Saga State: step=PAYMENT, step_requested_at=10:00, timeout=60s

10:01 스케줄러 체크:
  "60초 지났는데 응답 없네"
  retry_count < max_retries?
    ├─ YES → 새 Outbox INSERT (재발행) → retry_count++
    └─ NO  → ABORTING → 보상 시작
```

### 장애 상황별 대응

| 장애 상황 | 해결 |
|-----------|------|
| Outbox → 브로커 발행 실패 | Outbox Poller 재시도 |
| 브로커 → 컨슈머 전달 중 유실 | Saga 타임아웃 → 재발행 |
| 컨슈머 처리 중 서버 다운 | Saga 타임아웃 → 재발행 |
| 참여자 → 오케스트레이터 응답 유실 | Saga 타임아웃 → 재발행 |
| 브로커 자체 다운 | Outbox가 PUBLISHED 상태로 남아있음 → Saga 타임아웃으로 재발행 |

Saga State 타임아웃이 최종 안전망이기 때문에 ACK 여부에 의존할 필요가 없다. ACK는 PEL(Pending Entry List)이 쌓이지 않게 하는 **위생 관리** 정도의 역할이다.

---

## 3. 보상 트랜잭션

### 보상 실패 시 대응 단계

보상 트랜잭션이 실패하면 자동으로 해결할 수 없는 영역에 진입한다. 대응은 단계적으로 이루어진다.

1. **자동 재시도** — 지수 백오프: 1초 → 5초 → 30초
2. **알림** — 슬랙/이메일: "Saga AAA 보상 실패 - 수동 처리 필요"
3. **수동 재시도 API** — `POST /admin/saga/{sagaId}/retry-compensation`
4. **수동 보정** — 운영자가 직접 처리 → Saga 상태를 MANUALLY_RESOLVED로 변경

### 분산 시스템의 근본적 한계

보상도 실패하고 수동으로도 안 되면? 이건 **코드의 영역이 아니라 운영 프로세스의 영역**이다. "돈이 빠져나갔는데 취소가 안 돼?"는 CS팀 → 고객 연락 → 카드사 수동 취소로 이어진다. 100% 자동화는 불가능하다.

Saga 패턴을 도입한다는 건 "자동으로 다 해결되겠지"가 아니라 **"실패를 인정하고, 빠르게 감지하고, 복구할 수 있는 도구를 준비하겠다"**라는 것이다.

### 필요한 준비물

| 준비물 | 이유 |
|--------|------|
| Step Log | 어디서 멈췄는지 정확히 파악 |
| saga_data | 수동 처리에 필요한 데이터 |
| 알림 | 빠르게 감지 |
| 어드민 API | 재시도 / 수동 상태 변경 |
| 운영 매뉴얼 | "이 상황이면 이렇게 해라" |
