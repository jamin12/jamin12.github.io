---
title: "Go 프로젝트 구조와 클린 아키텍처"
date: 2026-06-11
tags: [go, architecture, clean-architecture, dependency-inversion]
order: 1
---

Spring Boot에 익숙한 상태로 Go 서버 코드를 처음 열면 가장 먼저 막히는 건 문법이 아니라 구조다. `@RestController`, `@Service`, `@Repository`가 한 클래스에 모여 있는 MVC를 기대하지만, 실무 Go 프로젝트는 대부분 클린 아키텍처를 따르고 패키지가 역할별로 잘게 나뉘어 있다.

이 글은 실제 Go 서버 프로젝트 하나를 기준으로, 패키지가 어떤 역할을 하고 요청 하나가 어떤 경로로 흐르는지 정리한다.

## 큰 그림: 인터페이스는 안쪽에, 구현은 바깥쪽에

클린 아키텍처의 핵심은 한 문장이다. **안쪽 레이어는 인터페이스(포트)에만 의존하고, 바깥쪽 레이어가 그 인터페이스를 구현한다.** 모든 소스 의존성이 안쪽을 향한다는 이 규칙을 의존성 규칙(The Dependency Rule)이라 한다.

이게 가능한 건 의존성 역전 원칙(DIP) 덕분이다. DIP와 "의존성이 안쪽을 향한다"는 같은 말이 아니다. 안쪽 유스케이스가 바깥 DB를 호출할 때 제어 흐름은 안→밖으로 흐른다. 이때 소스 의존성을 제어 흐름과 같은 방향으로 두면 유스케이스가 DB 구현에 직접 의존하게 된다. DIP는 인터페이스를 안쪽에 두고 바깥 구현이 그것을 구현하게 만들어, **소스 의존성의 방향을 제어 흐름과 반대로(밖→안) 뒤집는다.** 이 "뒤집기" 덕분에 제어는 밖으로 흐르면서도 의존성은 안쪽을 향하게 된다.

그래서 MVC처럼 controller·service·repository가 한곳에 모여 있지 않고, 다음처럼 갈린다.

```
app/
├── interface/      ← 인터페이스(포트)만 정의. 구현 없음
│   ├── controller/   인바운드 포트
│   ├── usecase/      유스케이스 포트 + 요청/응답 DTO
│   ├── repository/   저장소 포트 + 도메인 모델
│   └── adapter/      외부 시스템 포트 (IConfig, IBraze ...)
├── domain/         ← 도메인 로직 구현 (비즈니스 규칙)
├── usecase/        ← 유스케이스 구현 (도메인 조합)
└── core/           ← 보안 등 코어

infrastructure/     ← 포트들의 실제 구현 = 어댑터
├── gopg/             repository 포트 구현 (PostgreSQL)
├── http/             controller 포트 구현 (HTTP 핸들러)
├── grpc/             gRPC 서버
└── adapter/          외부 SaaS 어댑터 (slack, s3 ...)

registry/           ← 모든 레이어를 조립 (Composition Root)
cmd/                ← main 진입점
```

## interface 패키지가 핵심이다

가장 헷갈리는 지점은 `app/interface`다. 이름 때문에 "구현이 다 바깥에 있나?" 싶지만 그렇지 않다.

- `app/interface/` — **인터페이스(포트)만** 모여 있는 곳이다.
- `app/domain/`, `app/usecase/` — **비즈니스 로직 구현**이 들어 있다. 바깥(infra)이 아니다.
- `infrastructure/` — DB·HTTP·외부 연동처럼 **기술에 의존하는 구현**만 들어 있다.

즉 구현은 안쪽(domain/usecase)과 바깥쪽(infrastructure) 양쪽에 있고, infra에는 "갈아끼울 수 있는 기술적 구현"만 둔다. 도메인 코드는 `gopg`(PostgreSQL 드라이버)나 HTTP 프레임워크를 직접 모르고, `repository.ICoupon` 같은 인터페이스만 안다.

## 포트의 방향 — 인바운드와 아웃바운드

`app/interface` 아래의 포트는 방향으로 나뉜다.

- **인바운드 포트(driving)**: 바깥이 앱을 호출하는 진입점. `controller`, `usecase`.
- **아웃바운드 포트(driven)**: 앱이 바깥을 호출하는 출구. `repository`, `adapter`.

그래서 `adapter`나 `repository`는 사실상 "앱이 외부를 향해 부르는 아웃바운드 포트"다. 폴더 이름이 `adapter`라 헷갈리지만 내용물은 인터페이스다. 실제 어댑터(구현)는 `infrastructure`에 있다.

## 요청 하나의 흐름

쿠폰 조회를 예로 들면 다음 경로를 탄다.

```
HTTP 요청
  → infrastructure/http (Controller 구현)
  → app/interface/usecase.ICoupon (포트)
  → app/usecase/coupon.go (UseCase 구현)
  → app/domain/.../coupon.go (도메인 서비스, 비즈니스 규칙)
  → app/interface/repository.ICoupon (포트)
  → infrastructure/gopg/coupon.go (Repository 구현, DB)
```

안쪽은 인터페이스에만 의존하고, 바깥이 그 인터페이스를 구현한다. 이 방향이 깨지지 않는 한 도메인 코드는 기술 세부사항을 모른 채로 유지된다.

## Spring Boot와의 대응

| 역할 | Spring Boot | Go (이 구조) |
|---|---|---|
| 컨트롤러 | `@RestController` | `infrastructure/http` 핸들러 |
| 서비스 | `@Service` | `app/domain`, `app/usecase` 구현 |
| 리포지토리 계약 | `interface XxxRepository` | `app/interface/repository` |
| 리포지토리 구현 | JPA 구현체 | `infrastructure/gopg` |
| 빈 조립 | 컴포넌트 스캔 | `registry` (Composition Root) |

Spring은 어노테이션으로 자동 스캔·주입하지만, Go는 그 조립을 `registry`에서 명시적으로 한다. 이 조립을 무엇으로 하는지는 마지막 글(의존성 주입)에서 다룬다.
