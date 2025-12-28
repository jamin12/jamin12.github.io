---
layout: post
title: "Prometheus와 Spring Boot 연결 (다른 클라우드 환경)"
date: 2025-12-28
categories: [기타, 러너스하이2, 주제2]
tags: [러너스하이2_주제2]
---

## 처음 막혔던 것

처음엔 “도메인으로 연결하면 되나?”, “Ingress LB 공인 IP면 되는가?” 같은 질문을 계속 했다.  
하지만 **Ingress LB는 들어오는 트래픽용**이고,  
Prometheus가 EC2로 나갈 때의 소스 IP랑은 관련이 없었다.

그리고 “LB 공인 IP가 125.6.36.6이면 125.6.0.0/16 열면 되는가?”도 고민했는데  
이건 공용 인터넷 대역이라 거의 **0.0.0.0/0에 가깝게 열리는 위험한 방식**이었다.

## 노드 공인 IP 하나 열기

클러스터에 NAT도 없고 노드 공인 IP도 없는 구조라  
**NAT/Egress 고정 IP**를 사용하는게 좋은거 같지만, 비용 때문에 포기했다.

그래서 현실적인 선택은 “**노드 공인 IP 하나만 열기**”였다.

- k8s 노드에 공인 IP를 붙임
- 그 IP만 EC2 Security Group에 **포트 인바운드 허용**
- Prometheus에서 EC2 공인 IP로 직접 스크랩

사이드 프로젝트엔 이게 제일 빠르고 저렴했다.

## Spring Boot 엔드포인트 정리

Spring Boot는 **management 포트를 분리**했고 base-path도 커스터마이즈했다.

```yaml
management:
  server:
    port: 50001
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
      base-path: /explore/exposure
```

그래서 Prometheus가 붙어야 하는 URL은:

``` text
http://EC2_PUBLIC_IP:50001/explore/exposure/prometheus
```

그런데 실제로 접근하면 404가 나왔다.  
`/explore/exposure`에 들어가 보니 **prometheus 링크가 없었다.**

## Prometheus registry가 없었다

Actuator는 살아있는데 `prometheus`만 없다는 건  
대부분 **`micrometer-registry-prometheus` 의존성이 빠졌다는 뜻**이었다.

```gradle
implementation "org.springframework.boot:spring-boot-starter-actuator"
implementation "io.micrometer:micrometer-registry-prometheus"
```

이걸 추가하고 재배포하니  
`/explore/exposure/prometheus`에서 메트릭 텍스트가 정상적으로 나왔다.

## 최종 확인

Prometheus UI에서 `Status -> Targets`에 `noo-admin-ec2`가 **UP** 뜨는지 확인했다.  

## 정리

- **다른 클라우드/다른 클러스터**면 ServiceMonitor 대신 static target이 현실적
- NAT Gateway가 없으면 **노드 공인 IP 방식**이 제일 빠른 대안
- 하지만 보안상 리스크가 있으니 **IP /32만 허용**하는 게 필수
- Prometheus endpoint가 안 뜨면 **Actuator가 아니라 registry 의존성**부터 확인

사이드 프로젝트라 비용을 아끼는 선택을 했고,  
결과적으로 최소한의 설정으로 Prometheus와 Spring Boot를 연결할 수 있었다.
