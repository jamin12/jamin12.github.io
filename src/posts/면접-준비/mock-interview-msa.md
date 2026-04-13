---
title: MSA 프로젝트 모의 면접 정리
date: 2026-04-09
tags: [msa, ddd, hexagonal, interview]
private: true
---

MSA 도입과 헥사고날 아키텍처 프로젝트를 주제로 한 모의 면접을 정리했다. 주제별 Q&A, 잘 답변한 부분, 보완이 필요한 부분을 함께 기록한다.

## 프로젝트 개요

- **스택**: Kotlin/Spring, 멀티 모듈 모노레포
- **BC 3개**: Kubernetes / Portal / Member
- **아키텍처**: 헥사고날 (포트/어댑터)
- **통신**: 동기(요청-응답) + 비동기(Redis Stream + Outbox 패턴)
- **인증**: Keycloak (OAuth2 Authorization Code Flow + PKCE)
- **인프라**: 프라이빗 클라우드, K8s

---

## 1. DDD & 바운디드 컨텍스트

### Q. 이벤트 스토밍 결과 BC가 몇 개였고, 각각 어떤 도메인?

총 3개. Kubernetes 관련 / Portal 관련 / Member 관련. 내가 담당한 구역은 Member의 인증, Kube의 workload·ns·storage, Portal의 권한과 프로젝트.

### Q. Portal 권한 vs Member 인증/인가를 별도 컨텍스트로 분리한 기준?

인증은 Keycloak으로 공통 처리, 인가는 공통 모듈로 처리했다. Portal에 권한을 둔 이유는 프로젝트 및 조직별 권한이 따로 존재하기 때문이다. 멤버에 권한이 속한 게 아니라 **조직에 속한 멤버가 가지는 권한** — 한 명의 멤버여도 다른 조직에 가면 다른 권한을 가져야 한다고 판단해서 Portal에 넣었다. Kube와 Portal의 경계는 "쿠버네티스를 다루는가 vs 서비스 도메인을 다루는가"로 나눴다.

---

## 2. 권한 확인 흐름 & 장애 대응

### Q. Kube 서비스에서 권한 확인 흐름?

Spring Security의 `hasPermission`을 전략 패턴으로 확장하고, Kube에 요청이 들어오면 Portal에 동기 호출을 보내 권한 승인/거부를 판단한다.

### Q. Portal 장애 시 Kube 블로킹 대응?

- Portal Pod를 2개 이상 띄워 가용성 확보
- **서킷브레이커** 적용, fallback으로 에러 반환
- 캐싱은 검토했지만 미적용 — 권한이 민감한 데이터라 캐시와 실제 데이터의 불일치가 위험하다고 판단 (예: 삭제 권한이 캐시에 남아있으면 권한 없는 사람이 삭제 가능)

### Q. 서킷브레이커 Open 시 권한 필요한 모든 기능이 사용 불가인데, 읽기/쓰기 권한을 분리해서 전략을 다르게 가져가는 방식은?

따로 검토하지 않았다.

### 보완 포인트

면접관이 원한 답변 방향은 **위험도에 따라 전략을 다르게 가져가는 것**이다.

- **조회(읽기) 권한**: 서킷브레이커 Open 시 짧은 TTL 캐시로 fallback → 가용성 확보. 캐시가 틀려도 "볼 수 있는 걸 못 보는" 정도의 리스크
- **삭제/수정(쓰기) 권한**: 정합성이 치명적 → 캐시 fallback 불가, 서킷 Open 시 에러 반환이 맞음
- 핵심은 **"모든 권한을 같은 전략으로 처리하지 않는다"**는 것

---

## 3. 헥사고날 아키텍처

### Q. 포트와 어댑터를 어떻게 구성했는지?

포트와 어댑터 둘 다 In/Out으로 구성했다.

- **InPort**: 하나의 인터페이스에 하나의 함수만 정의, UseCase가 구현체
- **OutPort**: 마찬가지로 하나의 함수만 정의, OutAdapter가 구현체
- **InAdapter**: Controller 또는 Redis Stream 구독자
- **OutAdapter**: 외부 API 호출 (Keycloak, Redis 등)

단일 책임 원칙을 지키고 싶었고, 코드 가독성 때문에 이렇게 정했다.

### Q. 인터페이스가 많아지는 문제?

패키지를 도메인 기준으로 나눴고, 네이밍 규칙으로 관리했다. 예: `GetMemberInPort.kt`, `ListMemberInPort.kt`. 파일이 이름별로 정렬되어 찾기 어렵지 않았다.

### Q. 하나의 UseCase에 주입되는 OutPort가 몇 개?

많아도 5개를 넘지 않았고, 의존성이 많아지는 것을 크게 문제로 보지 않았다.

### 보완 포인트

면접관이 원한 건 "파일을 찾기 쉬운가"가 아니라 **"구조적으로 괜찮은가"**였다.

- OutPort 5개는 ISP(Interface Segregation Principle)를 따른 결과로, 하나의 거대한 Repository보다 의도가 명확
- 다만 5개 이상 넘어가면 UseCase가 너무 많은 책임을 가진 건 아닌지 의심해볼 시점
- Facade로 묶으면 원래 분리한 의미가 퇴색되므로, UseCase 자체를 쪼개는 게 맞음

---

## 4. 인증 (Keycloak + OAuth2)

### Q. Keycloak 선택 이유?

기존 서비스와 연동을 위해 Keycloak을 사용해야 하는 제약이 있었다.

### Q. 인증 흐름 전체?

1. 사용자가 로그인 요청
2. 백엔드가 리다이렉트 URL 반환
3. 프론트가 해당 URL로 이동 → Keycloak 로그인
4. 로그인 성공 시 **authorization code** + **state** 수신
5. 프론트가 code를 백엔드로 전송
6. 백엔드가 code + **PKCE code verifier**로 Keycloak에 토큰 요청
7. access token + refresh token 발급 → 프론트에 전달

### Q. Redis에 어떤 토큰을 왜 저장?

**PKCE code verifier**를 저장했다. 리다이렉트 URL을 넘겨줄 때 생성하고, 이후 code로 토큰을 받아올 때 필요해서 임시 저장했다.

---

## 5. Redis Stream & Outbox 패턴

### Q. 왜 Kafka/RabbitMQ가 아닌 Redis Stream?

프라이빗 클라우드에서 할당된 자원이 적어 여러 소프트웨어를 띄우기 어려웠다. 기존에 사용 중이던 Redis를 활용해 구현했다. 다만 Redis Stream은 메모리 기반이라 브로커 자체가 죽으면 메시지 유실 가능성이 있다. 그래서 Outbox 테이블을 source of truth로 삼고, Saga 타임아웃을 최종 안전망으로 두어 브로커 의존도를 낮추는 구조를 택했다.

### Q. Outbox 패턴 전체 흐름?

서비스가 발행자이자 소비자라면 테이블 4개가 필요하다.

| 테이블 | 역할 |
|--------|------|
| **Outbox** | 발행 보장. PENDING → PUBLISHED. 발행되면 역할 끝, 배치 삭제 대상 |
| **Saga State** | 워크플로우 추적. saga_id 1행을 계속 UPDATE. current_step, status, saga_data(스텝별 결과 누적) |
| **Step Log** | 이력 기록. INSERT 전용. 에러 덮어쓰기 방지 — Saga State에 error 컬럼 하나만 두면 보상 중 에러가 원본 에러를 덮어씀 |
| **Processed Event** | 멱등성 체크. saga_id + step 복합 PK로 이미 처리된 메시지인지 판단 |

흐름 예시 (NS 생성 → 리소스 쿼터 생성 → 리밋 레인지 생성 → NS DB 등록 → 멤버 매칭):

1. Controller에서 NS 생성 요청 → Saga State INSERT(STARTED) + Outbox INSERT(첫 Step 이벤트) — 같은 트랜잭션
2. Outbox Poller(스케줄러)가 PENDING 건을 Redis Stream에 push, PUBLISHED로 마킹
3. Consumer가 이벤트 수신 → Processed Event로 중복 체크 → 비즈니스 로직 실행 → 결과 Outbox INSERT — 같은 트랜잭션
4. 오케스트레이터가 결과 수신 → Saga State UPDATE(다음 step) + Step Log INSERT + 다음 Outbox INSERT

### Q. 중복 발행 문제는?

발행 측 중복을 인정하고, **소비 측에서 멱등하게 처리**하는 방식을 택했다. 구체적으로는 Processed Event 테이블에 saga_id + step을 복합 PK로 두고, 메시지 수신 시 조회해서 이미 있으면 skip, 없으면 처리 + INSERT를 같은 트랜잭션으로 묶는다.

서버 다운 시에도 안전하다:
- **COMMIT 전 다운** → 전부 롤백 → 재시도 시 처음부터 정상 처리
- **COMMIT 후 ACK 전 다운** → Processed Event에 이미 기록됨 → 재시도 시 skip + Outbox 응답은 이미 INSERT됐으니 Poller가 발행

### Q. 재시도는 어떻게 처리하나?

재시도가 두 레벨로 존재한다.

| 레벨 | 테이블 | 대상 |
|------|--------|------|
| 발행 재시도 | Outbox retry_count | 브로커에 못 보냈을 때 |
| Step 재시도 | Saga State retry_count | 보냈는데 응답이 안 올 때 (타임아웃) |

재시도 **판단**은 Saga State가 하고, 실제 **발행**은 항상 Outbox를 통한다. 타임아웃 시 기존 Outbox 행을 재사용하는 게 아니라 **매번 새 행을 INSERT**한다.

```
Saga State: step=PAYMENT, step_requested_at=10:00, timeout=60s
10:01 스케줄러 체크: "60초 지났는데 응답 없네"
  retry_count < max_retries → 새 Outbox INSERT + retry_count++
  retry_count >= max_retries → ABORTING → 보상 시작
```

### Q. 보상 트랜잭션이 실패하면?

자동으로 해결할 수 없는 영역이므로 단계적으로 대응한다.

1. **자동 재시도** — 지수 백오프: 1초 → 5초 → 30초
2. **알림** — 슬랙/이메일: "Saga AAA 보상 실패 - 수동 처리 필요"
3. **수동 재시도 API** — `POST /admin/saga/{sagaId}/retry-compensation`
4. **수동 보정** — 운영자가 직접 처리 → Saga 상태를 MANUALLY_RESOLVED로 변경

Saga 패턴을 도입한다는 건 "자동으로 다 해결되겠지"가 아니라 **"실패를 인정하고, 빠르게 감지하고, 복구할 수 있는 도구를 준비하겠다"**는 것이다. Step Log에 어디서 멈췄는지 남아있고, saga_data에 수동 처리에 필요한 데이터가 있어야 운영이 가능하다.

### Q. 동시에 "대기"로 읽히는 경합 조건?

Saga State에 **version 컬럼(낙관적 락)**을 두어 해결한다. 동시에 같은 Saga를 업데이트하려는 경우 version 불일치로 하나만 성공하고 나머지는 재시도한다.

Outbox Poller에서는 `UPDATE ... WHERE status = 'PENDING'`의 **affected rows**로 판단하면 락 없이도 원자적 처리가 가능하다. 업데이트된 행이 있으면 해당 건을 발행, 없으면 이미 다른 인스턴스가 처리한 것이므로 skip.

### Q. 트래픽 많아지면 가장 먼저 병목이 될 곳?

1. **Poller의 polling 주기** → 트래픽이 많아지면 1초 주기 대신 CDC(Change Data Capture) 방식으로 전환. Debezium이 Outbox 테이블 변경을 감지해 바로 브로커에 넣어주면 polling 지연 제거
2. **Consumer 처리 능력** → Redis Stream의 Consumer Group으로 인스턴스 간 분배 + 인스턴스 내부에서는 스레드풀로 병렬 처리. 병목은 stream 개수가 아니라 consumer 처리 능력으로 풀어야 함

---

## 6. 오케스트레이션 구조 & 리팩터링

### Q. Saga 흐름 제어를 어떻게 구현했는지?

처음에는 중앙 오케스트레이션으로 구현했다. 중앙 레지스트리에 비즈니스 흐름을 정의하고, 라우터가 이벤트 타입을 보고 전용 처리기(Handler)로 분배하는 구조였다.

동작은 했지만 규모가 커지면서 문제가 드러났다. 처리기 71개, 라우터 14개, 구독자 17개, 보상 조정기와 완료 처리기까지 **Saga 전용 파일만 70개 이상**으로 폭발했다. 더 큰 문제는 이 구조가 기존 헥사고날 아키텍처에서 완전히 벗어나 있다는 것이었다. Saga 처리기는 기존 UseCase와 거의 같은 일을 하면서도, Saga 전용 인프라를 직접 의존하는 독자적 구조였다.

### Q. 어떻게 해결했는지?

핵심 발상은 **"Controller가 HTTP 요청을 받아 UseCase를 호출하듯, Consumer가 이벤트를 받아 UseCase를 호출하면 된다"**는 것이었다.

```
REST 요청 흐름:  Controller → InPort → UseCase → OutPort
Saga 결과 수신:  @StepHandler → InPort → UseCase → OutPort
```

중앙 레지스트리·라우터를 제거하고, Consumer 클래스 자체가 오케스트레이터 역할을 한다. Consumer가 결과를 수신해서 다음 UseCase를 호출하는 구조다. UseCase는 결과만 발행하고, 다음 Step이 뭔지는 모른다.

이 리팩터링으로 Saga 전용 인프라 약 70개 파일이 제거됐고, 구독자는 17개에서 3개로 줄었다. 기존 REST API 패턴을 아는 사람이면 분산 트랜잭션 코드도 바로 읽을 수 있는 구조가 됐다.

### 보완 포인트

이 질문이 나오면 **"왜 중앙 오케스트레이션이 문제였는지 → 어떤 원칙으로 전환했는지 → 결과가 어땠는지"**의 흐름으로 답변해야 한다. 단순히 "리팩터링했다"가 아니라, 기존 아키텍처(헥사고날)와의 일관성을 회복했다는 점이 핵심이다.

---

## 7. 모노레포 멀티 모듈

### Q. 공통 모듈 변경 시 다른 서비스가 깨지지 않는 보장?

- 공통 모듈을 가능한 잘게 쪼갬 (JPA, 인증 등 따로)
- 공통 설정 위주 코드만 작성 — 함수나 클래스를 직접 사용하지 않고 의존성 추가만으로 설정이 세팅되도록
- 공통 모듈 변경 시 **모든 서비스의 CI가 실행**되어 테스트로 안전성 확보

### Q. 공통 모듈 때문에 다른 서비스 테스트가 깨졌던 경험?

따로 없었다.

---

## 8. Kube 데이터 관리

### Q. K8s API 데이터 vs DB 데이터 경계?

K8s에서 가져오는 데이터는 DB로 관리하지 않고 API에서 직접 가져왔다. DB는 서비스 고유 도메인(예: 네임스페이스에 할당된 멤버)만 저장했다.

### Q. 두 데이터 소스 조합 방식?

OutPort 2개를 사용 — 하나는 K8s API, 하나는 DB에서 가져와 합치는 역할.

### Q. K8s API 지연/타임아웃 처리?

따로 처리하지 않았다.

### 보완 포인트

- K8s API 호출에도 timeout 설정 필요
- Watch API로 변경분만 받아 로컬 캐시 유지 (Informer 패턴) → 매번 API 호출 대신 캐시에서 조회
- 서킷브레이커 적용 가능 — 원격 호출이 가장 전형적인 적용 대상

---

## 9. 관측성

미답변 — 면접 마지막 질문이었음.

### 준비할 답변

| 관측 영역 | 도구 | 구체적으로 본 것 |
|-----------|------|-----------------|
| **메트릭** | Prometheus + Grafana | P95/P99 latency, RPS, 4xx/5xx 비율, URI별 에러 분포 |
| **로그** | 중앙 집중 로그 | SSH + docker logs의 한계를 느끼고 개선 필요성 인식 |
| **트레이싱** | — | MSA에서 서비스 간 호출 체인 추적 필요 |

"URI별 P95 Latency Top 10으로 핫스팟을 찾고, RPS와 에러 상태코드 분포로 장애 원인을 분리했다"는 식으로 구체적 지표 언급하면 좋음.

---

## 전체 평가

### 강점

- **아키텍처 설계 근거가 명확** — BC 경계, Redis Stream 선택, 캐싱 미적용 모두 현실적 근거로 설명
- **Outbox 패턴 깊이 있는 이해** — 4개 테이블 역할 분리, 멱등성, 두 레벨 재시도, 보상 실패 대응까지
- **오케스트레이션 리팩터링 경험** — 문제 인식 → 원칙 기반 전환 → 정량적 결과(파일 70개 제거, 구독자 17→3개)
- **OAuth2/PKCE 흐름 정확** — code, state, code verifier 역할을 정확히 구분

### 반복된 약점 패턴

"따로 검토하지 않았다" / "따로 없다"가 3번 나옴:
1. 읽기/쓰기 권한 분리
2. K8s API 지연 처리
3. 관측성

모르는 건 괜찮지만, **"검토하지 않았지만 지금 생각해보면..."**으로 즉석 대안을 제시하는 연습이 필요하다. Outbox 병목 질문에서는 그걸 해내서 면접관이 인정했다 — 그 패턴을 다른 약점에도 적용하면 된다.
