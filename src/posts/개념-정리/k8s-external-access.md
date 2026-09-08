---
title: 외부에서 파드에 접속하는 방법
date: 2025-06-24
tags: [k8s, networking, service]
summary: Service 없이 파드에 접근하는 port-forward, hostPort, hostNetwork와 각각을 운영에서 쓰지 않는 이유
order: 15
---
## 1. 포트 포워딩 (kubectl port-forward)

개발, 테스트, 디버깅할 때 **임시로** 파드에 접근할 수 있는 방법입니다.

```bash
kubectl port-forward pod/my-pod 8080:80
```

내 PC의 8080 포트가 파드의 80 포트로 연결됩니다.

- **임시 연결**이므로 프로세스가 종료되면 사라짐
- 운영 환경에서는 잘 사용하지 않음
- 빠르게 내부 파드를 확인할 때 편리

## 2. HostPort

```yaml
ports:
  - containerPort: 80
    hostPort: 8080
```

해당 파드가 배포된 **노드의 IP:8080**으로 접속하면 파드로 트래픽이 전달됩니다.

단점

- **파드가 어느 노드에 배포됐는지 외부에서 알아야 함**
- 여러 파드가 같은 hostPort를 사용할 수 없음
- 운영환경에서는 거의 사용하지 않음

## 3. HostNetwork

파드를 노드의 네트워크 네임스페이스에 직접 연결하는 방법입니다.

```yaml
spec:
  hostNetwork: true
```

파드가 올라간 노드의 IP와 포트를 직접 점유하게 됩니다.

단점

- 네트워크 충돌 및 보안 이슈가 많아 실무에서는 거의 사용하지 않음
- 도커 등 컨테이너의 HostNetwork와 유사한 개념
