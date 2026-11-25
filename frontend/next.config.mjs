/** @type {import('next').NextConfig} */
const nextConfig = {
  // 정적 파일로 내보내 어떤 웹 서버/스토리지에서도 호스팅할 수 있게 한다.
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
