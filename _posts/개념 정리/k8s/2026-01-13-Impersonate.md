---
layout: post
title: "Impersonate"
date: 2026-01-13
categories: [개념정리, k8s]
tags: [k8s]
---

## 요청 처리 단계 분리

Kubernetes의 API 요청은 Authentication(인증)과 Authorization(인가) 단계로 나뉜다.
Impersonation은 이 두 단계 사이에서 동작한다.

일반적인 요청 흐름은 다음과 같다.

```text
1. 인증: Bearer token 확인 → User=alice
2. 인가: User=alice가 해당 API를 호출할 권한이 있는지 확인
```

Impersonation 헤더가 포함된 요청은 처리 과정이 달라진다.

```text
Authorization: Bearer <platform-sa-token>
Impersonate-User: user-123
Impersonate-Group: project-9-admin
```

이 요청은 내부적으로 두 번의 검증을 거친다.

### 1단계: 실제 호출자 인증

먼저 헤더에 실린 토큰 자체를 검증한다.

```text
Bearer token → system:serviceaccount:system-ns:system-sa
```

이 시점에서 요청의 주체는 플랫폼 SA다.

### 2단계: 신원 교체(Impersonation) 권한 확인

Kubernetes는 플랫폼 SA가 요청 헤더에 지정된 유저(`user-123`)와 그룹(`project-9-admin`)으로 가장할 권한이 있는지 확인한다.

이때 확인하는 RBAC은 다음과 같다.

```yaml
resources: ["users", "groups"]
verbs: ["impersonate"]
```

이 권한이 없다면 403 에러가 발생하며 요청이 차단된다.

### 3단계: 컨텍스트 교체 및 실제 작업 인가

가장 권한이 확인되면, Kubernetes는 **요청 컨텍스트의 UserInfo를 교체**한다.

```text
변경 전: User = system:serviceaccount:system-ns:system-sa
변경 후: User = user-123, Groups = [project-9-admin]
```

중요한 점은 토큰 자체가 바뀌는 것이 아니라, 메모리 상의 요청자 정보만 변경된다는 것이다.
이제 교체된 신원으로 실제 요청(예: `pods list`)에 대한 권한을 검사한다.

```text
user-123 (group=project-9-admin)이 pods list를 수행할 수 있는가?
```

이 단계에서는 플랫폼 SA의 권한은 더 이상 관여하지 않는다. 오직 타겟 유저의 RBAC만 적용된다.

## 보안 모델의 분리

이 구조를 통해 권한 모델을 명확히 분리할 수 있었다.

| 주체      | 역할  | 제어 범위                    |
| --------- | ----- | ---------------------------- |
| 플랫폼 SA | Proxy | 누구로(Who) 변신할 수 있는가 |
| 고객 User | Actor | 무엇을(What) 할 수 있는가    |

플랫폼은 "누구로 변할 수 있는지"만 제어하고, 실제 작업 권한은 고객의 RBAC 설정에 따르게 된다.

## Platform SA 권한 설정 시 주의사항

분석 과정에서 **Platform SA에 `cluster-admin` 권한을 부여하면 보안 모델이 붕괴된다**는 점을 확인했다.

Platform SA가 `cluster-admin`을 가지고 있다면, 다음과 같은 요청이 가능해진다.

```text
Impersonate-User: user-123
Impersonate-Group: system:masters
```

Kubernetes는 `Impersonate-Group` 헤더에 적힌 그룹이 실제 해당 유저의 그룹인지 검증하지 않는다.
단지 플랫폼 SA가 "해당 그룹으로 가장할 권한"이 있는지만 확인한다.
플랫폼 SA가 강력한 권한을 가지면 임의의 그룹(예: `system:masters`)으로 가장하여 모든 권한을 획득할 수 있게 된다.

따라서 Impersonation을 사용하는 주체에게는 최소한의 `impersonate` 권한만 부여해야 안전한 구조가 유지된다.
