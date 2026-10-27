import { it, expect } from "vitest";
import { explicitLoginPage } from "../../src/collector/session";
it("does not mistake blank, loading or changed pages for expired login", () => {
  for (const text of ["", "加载中", "服务暂时不可用"]) {
    expect(
      explicitLoginPage("xjtu", "https://lms.xjtu.edu.cn/user/index#/", text),
    ).toBe(false);
    expect(
      explicitLoginPage("icourse", "https://www.icourse163.org/", text),
    ).toBe(false);
  }
});
it("recognizes actual sign-in evidence without trusting lookalike hosts", () => {
  expect(
    explicitLoginPage(
      "xjtu",
      "https://identity1.xjtu.edu.cn/cas/login",
      "统一认证",
    ),
  ).toBe(true);
  expect(
    explicitLoginPage(
      "xjtu",
      "https://identity1.xjtu.edu.cn.example.org/",
      "加载中",
    ),
  ).toBe(false);
  expect(
    explicitLoginPage("icourse", "https://www.icourse163.org/", "登录/注册"),
  ).toBe(true);
});
