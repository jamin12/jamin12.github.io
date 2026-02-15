---
layout: post
title: "Argo Rollouts - Canary 배포"
date: 2026-02-06
categories: [개념정리, k8s]
tags: [kubernetes, argo-rollouts, canary, nginx-ingress, istio, devops]
---

## 1. 아키텍처 구성

![Canary Architecture: Nginx Ingress vs Istio](/assets/imgs/posts/개념정리/k8s/canary_k8s_architecture.png)

stableService는 기존 버전의 트래픽을, canaryService는 새 버전의 트래픽을 받는다. 트래픽 라우팅 도구(Nginx Ingress 또는 Istio)가 비율을 제어하며, Argo Rollouts Controller가 이를 자동으로 관리한다.

Blue-Green과 달리 두 버전이 동시에 트래픽을 받으며, 비율을 점진적으로 조절한다.

## 2. 트래픽 분배 원리

### Blue-Green vs Canary

Blue-Green은 Service의 selector hash를 교체해서 트래픽을 한 번에 전환했다. Canary는 접근 방식이 다르다.

| 항목 | Blue-Green | Canary |
|------|-----------|--------|
| 트래픽 제어 | Service selector 교체 | 트래픽 라우팅 도구 활용 |
| 전환 방식 | 0% → 100% 즉시 | 점진적 (10% → 30% → 100%) |
| 제어 대상 | Service | Ingress / VirtualService |
| 정밀도 | 전부 또는 없음 | 1% 단위 |

### 트래픽 라우팅이 없는 경우

Nginx Ingress나 Istio 같은 트래픽 라우팅을 설정하지 않으면 Argo Rollouts는 ReplicaSet의 파드 수 비율로 트래픽을 간접 제어한다.

```text
replicas: 10, setWeight: 20인 경우

Service (app: myapp)
  ├── stable ReplicaSet (8 pods) ← 기존 버전
  └── canary ReplicaSet (2 pods) ← 새 버전
```

Kubernetes Service가 라운드로빈으로 분배하므로 파드 수 비율이 곧 트래픽 비율이 된다. 그러나 replicas가 10이면 최소 단위가 10%이고, 5%처럼 세밀한 제어는 불가능하다.

### 트래픽 라우팅이 있는 경우

트래픽 라우팅을 설정하면 파드 수와 무관하게 정확한 비율 제어가 가능하다. Argo Rollouts는 여러 트래픽 라우팅 도구를 지원하며, 대표적으로 Nginx Ingress와 Istio가 있다.

핵심 원리는 동일하다. Argo Rollouts가 `setWeight` 단계에 도달하면, 트래픽 라우팅 도구의 설정을 자동으로 수정하여 비율을 제어한다. 다만 **조작하는 대상**이 다르다.

![Canary Traffic Routing: Nginx vs Istio](/assets/imgs/posts/개념정리/k8s/canary_nginx_vs_istio_flow.png)

| 항목 | Nginx Ingress | Istio |
|------|--------------|-------|
| Argo가 조작하는 대상 | Ingress의 canary annotation | VirtualService의 route weight |
| 트래픽 분배 위치 | Ingress Controller (클러스터 진입점) | Envoy Sidecar (파드 레벨) |
| 외부 트래픽 | 카나리 적용됨 | 카나리 적용됨 |
| 내부 서비스 간 통신 | 카나리 적용 안 됨 | 카나리 적용됨 |
| 추가 리소스 | Ingress | VirtualService + DestinationRule |

마지막 행이 중요하다. Nginx Ingress는 클러스터 외부에서 들어오는 트래픽만 분배할 수 있다. 서비스 A → 서비스 B 같은 내부 통신에는 카나리 비율이 적용되지 않는다. 반면 Istio는 각 파드에 Envoy 사이드카가 붙어있어 내부 통신까지 제어된다.

## 3. 매니페스트 작성

### Rollout

Rollout의 `strategy.canary.steps`는 Nginx와 Istio 모두 동일하다. 차이는 `trafficRouting` 블록뿐이다.

#### Nginx Ingress 방식

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp-rollout
  labels:
    app: myapp
spec:
  replicas: 3
  revisionHistoryLimit: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.21.0
        ports:
        - containerPort: 80
        resources:
          requests:
            memory: "64Mi"
            cpu: "100m"
          limits:
            memory: "128Mi"
            cpu: "200m"
  strategy:
    canary:
      canaryService: myapp-canary-svc
      stableService: myapp-stable-svc
      trafficRouting:
        nginx:
          stableIngress: myapp-ingress
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - setWeight: 30
        - pause: { duration: 5m }
        - setWeight: 60
        - pause: {}
        - setWeight: 100
```

#### Istio 방식

Istio의 경우 `trafficRouting` 블록만 다르다. 나머지는 모두 동일하다.

```yaml
  strategy:
    canary:
      canaryService: myapp-canary-svc
      stableService: myapp-stable-svc
      trafficRouting:
        istio:
          virtualServices:
            - name: myapp-vsvc
              routes:
                - primary
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - setWeight: 30
        - pause: { duration: 5m }
        - setWeight: 60
        - pause: {}
        - setWeight: 100
```

`steps`가 Canary 배포의 핵심이다. 각 단계를 순차적으로 실행하며 트래픽 비율을 조절한다.

| Step 종류 | 설명 |
|----------|------|
| `setWeight` | 카나리로 보낼 트래픽 비율(%) 지정 |
| `pause: { duration: 5m }` | 지정 시간만큼 대기 (모니터링 시간) |
| `pause: {}` | 수동 `promote` 명령까지 무기한 대기 |
| `analysis` | AnalysisTemplate을 실행하여 자동 검증 |

`pause: {}`는 Blue-Green의 `autoPromotionEnabled: false`와 유사한 역할이다. 해당 단계에서 수동 승인을 기다린다.

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-stable-svc
spec:
  selector:
    app: myapp
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-canary-svc
spec:
  selector:
    app: myapp
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
```

Nginx와 Istio 모두 Service 정의는 동일하다. Blue-Green과 마찬가지로 두 Service의 selector가 동일하게 `app: myapp`으로 정의되어 있다. Argo Rollouts가 런타임에 `rollouts-pod-template-hash`를 추가하여 각 Service가 바라보는 ReplicaSet을 구분한다.

### Nginx: Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
spec:
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-stable-svc
            port:
              number: 80
```

이 Ingress는 stableService를 바라보도록 직접 정의한다. Canary Ingress는 Argo Rollouts가 자동 생성하므로 별도로 만들지 않는다.

### Istio: VirtualService + DestinationRule

Istio의 경우 Ingress 대신 VirtualService와 DestinationRule을 정의한다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp-vsvc
spec:
  hosts:
    - myapp.example.com
  http:
    - name: primary
      route:
        - destination:
            host: myapp-stable-svc
          weight: 100
        - destination:
            host: myapp-canary-svc
          weight: 0
```

초기에는 stable에 100%, canary에 0%로 설정한다. Argo Rollouts가 `setWeight` 단계마다 이 weight 값을 자동으로 업데이트한다.

## 4. 트래픽 라우팅 자동 조작 원리

### Nginx: Canary Ingress 자동 생성

`setWeight: 10` 단계에 도달하면 Argo Rollouts가 다음과 같은 Ingress를 자동 생성한다.

```yaml
# Argo Rollouts가 자동으로 생성하는 Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress-myapp-canary-svc
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-canary-svc
            port:
              number: 80
```

핵심은 두 가지 annotation이다.

| Annotation | 역할 |
|-----------|------|
| `nginx.ingress.kubernetes.io/canary: "true"` | 이 Ingress가 canary용임을 Nginx에 알림 |
| `nginx.ingress.kubernetes.io/canary-weight: "10"` | 전체 트래픽의 10%를 이 Ingress로 라우팅 |

Nginx Ingress Controller는 같은 host/path에 대해 `canary: "true"`가 붙은 Ingress를 발견하면 원본 Ingress와 함께 가중치 기반 트래픽 분배를 수행한다. 단계가 진행되면 Argo Rollouts는 `canary-weight` 값만 업데이트하고, 배포 완료 시 이 Ingress를 삭제한다.

### Istio: VirtualService weight 자동 수정

Istio의 경우, Argo Rollouts가 새 리소스를 만드는 것이 아니라 기존 VirtualService의 weight를 직접 수정한다.

`setWeight: 10` 단계에 도달하면:

```yaml
# Argo Rollouts가 자동으로 이렇게 변경함
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp-vsvc
spec:
  http:
    - name: primary
      route:
        - destination:
            host: myapp-stable-svc
          weight: 90              # ← Argo가 자동 수정
        - destination:
            host: myapp-canary-svc
          weight: 10              # ← Argo가 자동 수정
```

`setWeight: 30` 단계에서는 weight를 70/30으로 업데이트하고, 최종 promotion 시 stable 100% / canary route 제거로 변경한다.

### 비교: Argo가 조작하는 것

| 단계 | Nginx | Istio |
|------|-------|-------|
| setWeight: 10 | Canary Ingress **생성** (canary-weight: "10") | VirtualService weight **수정** (90/10) |
| setWeight: 30 | canary-weight annotation **업데이트** ("30") | VirtualService weight **수정** (70/30) |
| setWeight: 100 | Canary Ingress **삭제**, stable에 새 RS 연결 | canary route **제거**, stable에 새 RS 연결 |

## 5. 배포 흐름

![Canary Internal Flow](/assets/imgs/posts/개념정리/k8s/canary_internal_flow.png)

### 초기 상태

```text
[Nginx]
Ingress (myapp-ingress)
  └── myapp-stable-svc ──▶ hash: aaaa1111 ──▶ Stable Pods (v1.0)  ← 100%
canary Ingress: 없음

[Istio]
VirtualService (myapp-vsvc)
  route: stable 100% / canary 0%
  └── myapp-stable-svc ──▶ hash: aaaa1111 ──▶ Stable Pods (v1.0)  ← 100%
```

모든 트래픽이 기존 버전으로 전달된다.

### 새 버전 배포 (setWeight: 10)

```bash
kubectl argo rollouts set image myapp-rollout nginx=nginx:1.22.0
```

```text
[Nginx]
Ingress (myapp-ingress)
  └── myapp-stable-svc ──▶ Stable Pods (v1.0)  ← 90%
Canary Ingress (auto-generated, canary-weight: "10")  ← 자동 생성됨
  └── myapp-canary-svc ──▶ Canary Pods (v2.0)  ← 10%

[Istio]
VirtualService (myapp-vsvc)
  route: stable 90% / canary 10%  ← weight 자동 수정됨
  ├── myapp-stable-svc ──▶ Stable Pods (v1.0)  ← 90%
  └── myapp-canary-svc ──▶ Canary Pods (v2.0)  ← 10%
```

Argo Rollouts가 새 ReplicaSet을 생성한다. Nginx에서는 canary Ingress를 자동 생성하고, Istio에서는 VirtualService의 weight를 수정한다. 두 경우 모두 트래픽의 10%가 canary로 라우팅된다.

### Weight 증가 (setWeight: 30)

```text
[Nginx]  canary-weight annotation "10" → "30" 업데이트
[Istio]  VirtualService weight 90/10 → 70/30 업데이트
```

Argo Rollouts가 트래픽 라우팅 설정만 업데이트한다. 새로운 리소스를 만드는 것이 아니라 기존 설정값을 변경하는 것이다.

### Full Promotion (setWeight: 100)

```text
[Nginx]
Canary Ingress: 삭제됨
Ingress (myapp-ingress)
  └── myapp-stable-svc ──▶ hash: bbbb2222 ──▶ New Stable Pods (v2.0)  ← 100%

[Istio]
VirtualService (myapp-vsvc)
  route: stable 100%  (canary route 제거됨)
  └── myapp-stable-svc ──▶ hash: bbbb2222 ──▶ New Stable Pods (v2.0)  ← 100%
```

카나리가 stable로 승격된다. stableService의 selector가 새 hash로 변경되고, 이전 ReplicaSet은 0으로 축소된다. Nginx에서는 canary Ingress가 삭제되고, Istio에서는 canary route가 제거된다.

## 6. AnalysisTemplate을 활용한 자동 검증

Canary 배포의 강력한 기능은 자동화된 메트릭 검증이다. Prometheus 등의 메트릭 소스에서 데이터를 수집하고 성공/실패를 자동 판단한다. AnalysisTemplate은 Nginx/Istio와 무관하게 동일하게 작동한다.

### AnalysisTemplate 정의

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      interval: 60s
      count: 3
      successCondition: result[0] >= 0.95
      failureLimit: 1
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{
              status=~"2.*",
              service="{{args.service-name}}"
            }[5m]))
            /
            sum(rate(http_requests_total{
              service="{{args.service-name}}"
            }[5m]))
```

| 필드 | 설명 |
|------|------|
| `interval` | 측정 주기 |
| `count` | 총 측정 횟수 |
| `successCondition` | 이 조건을 만족하면 성공 |
| `failureLimit` | 허용 가능한 실패 횟수 (초과 시 롤백) |

### Rollout에 연결

```yaml
strategy:
  canary:
    steps:
      - setWeight: 20
      - analysis:
          templates:
            - templateName: success-rate
          args:
            - name: service-name
              value: myapp-canary-svc
      - setWeight: 50
      - pause: { duration: 5m }
      - setWeight: 100
```

`setWeight: 20` 이후 자동으로 성공률을 측정하고, 95% 미만이면 즉시 롤백된다. 수동 모니터링 없이 안전한 배포가 가능하다.

## 7. 롤백 시나리오

![Canary Rollback Scenario](/assets/imgs/posts/개념정리/k8s/canary_rollback_scenario.png)

### Analysis 실패 시 자동 롤백

```text
1. setWeight: 20  →  트래픽 20% 카나리로 전달
2. analysis 실행  →  에러율 측정 시작
3. 에러율 5% 초과 감지  →  failureLimit 초과
4. 자동 롤백 실행:
   [Nginx] canary Ingress 삭제 → 트래픽 100% stable 복원
   [Istio] VirtualService weight를 stable 100%로 복원
   [공통]  canary ReplicaSet replicas: 0
```
