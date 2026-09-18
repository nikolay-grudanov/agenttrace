/**
 * Tests for src/local-access.ts — F-026 hardening (private-network gate,
 * Host allow-list, hostname normalization).
 */
import { describe, expect, test } from "bun:test";
import {
  hostnameOnly,
  isLoopbackRemoteAddress,
  isPrivateRemoteAddress,
  parseAllowedHostsEnv,
} from "../src/local-access";

describe("isLoopbackRemoteAddress", () => {
  test("accepts IPv4 loopback (127.x.x.x)", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("127.255.255.254")).toBe(true);
  });

  test("accepts IPv6 loopback (::1, 0:0:0:0:0:0:0:1, ::ffff:127.x.x.x)", () => {
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
  });

  test("rejects RFC1918 private addresses (the gate narrows when no allow-list is set)", () => {
    expect(isLoopbackRemoteAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackRemoteAddress("172.17.0.1")).toBe(false);
    expect(isLoopbackRemoteAddress("192.168.1.1")).toBe(false);
    expect(isLoopbackRemoteAddress("169.254.169.254")).toBe(false);
  });

  test("rejects empty / public / non-IP input", () => {
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
    expect(isLoopbackRemoteAddress(null)).toBe(false);
    expect(isLoopbackRemoteAddress("")).toBe(false);
    expect(isLoopbackRemoteAddress("8.8.8.8")).toBe(false);
    expect(isLoopbackRemoteAddress("example.com")).toBe(false);
  });
});

describe("isPrivateRemoteAddress", () => {
  test("loopback still counts as private", () => {
    expect(isPrivateRemoteAddress("127.0.0.1")).toBe(true);
    expect(isPrivateRemoteAddress("::1")).toBe(true);
  });

  test("accepts RFC1918 ranges (10/8, 172.16/12, 192.168/16)", () => {
    expect(isPrivateRemoteAddress("10.0.0.1")).toBe(true);
    expect(isPrivateRemoteAddress("10.255.255.255")).toBe(true);
    expect(isPrivateRemoteAddress("172.16.0.1")).toBe(true);
    expect(isPrivateRemoteAddress("172.31.255.254")).toBe(true);
    expect(isPrivateRemoteAddress("192.168.1.1")).toBe(true);
    // Just outside RFC1918 — must NOT be private.
    expect(isPrivateRemoteAddress("172.15.0.1")).toBe(false);
    expect(isPrivateRemoteAddress("172.32.0.1")).toBe(false);
  });

  test("accepts link-local 169.254/16 (cloud metadata service, Docker bridge gateway)", () => {
    expect(isPrivateRemoteAddress("169.254.169.254")).toBe(true);
    expect(isPrivateRemoteAddress("169.254.0.1")).toBe(true);
  });

  test("accepts IPv6 unique-local (fc00::/7) and link-local (fe80::/10)", () => {
    expect(isPrivateRemoteAddress("fc00::1")).toBe(true);
    expect(isPrivateRemoteAddress("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateRemoteAddress("fe80::1")).toBe(true);
    expect(isPrivateRemoteAddress("fe80::dead:beef")).toBe(true);
    expect(isPrivateRemoteAddress("fe9a::1")).toBe(true);
  });

  test("accepts IPv4-mapped IPv6 private addresses", () => {
    expect(isPrivateRemoteAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateRemoteAddress("::ffff:172.17.0.1")).toBe(true);
    expect(isPrivateRemoteAddress("::ffff:192.168.65.2")).toBe(true);
  });

  test("rejects public IPv4 / IPv6 addresses", () => {
    expect(isPrivateRemoteAddress("8.8.8.8")).toBe(false);
    expect(isPrivateRemoteAddress("1.1.1.1")).toBe(false);
    expect(isPrivateRemoteAddress("172.15.0.1")).toBe(false);
    expect(isPrivateRemoteAddress("11.0.0.1")).toBe(false);
    expect(isPrivateRemoteAddress("2001:4860:4860::8888")).toBe(false);
  });

  test("rejects empty / null / non-IP input", () => {
    expect(isPrivateRemoteAddress(undefined)).toBe(false);
    expect(isPrivateRemoteAddress(null)).toBe(false);
    expect(isPrivateRemoteAddress("")).toBe(false);
    expect(isPrivateRemoteAddress("example.com")).toBe(false);
  });
});

describe("parseAllowedHostsEnv", () => {
  test("returns an empty set for null / undefined / empty string", () => {
    expect(parseAllowedHostsEnv(undefined).size).toBe(0);
    expect(parseAllowedHostsEnv(null).size).toBe(0);
    expect(parseAllowedHostsEnv("").size).toBe(0);
    expect(parseAllowedHostsEnv("   ,  ,,  ").size).toBe(0);
  });

  test("parses bare hostnames, lowercased", () => {
    expect([...parseAllowedHostsEnv("foo.local")]).toEqual(["foo.local"]);
    expect([...parseAllowedHostsEnv("FOO.LOCAL")]).toEqual(["foo.local"]);
  });

  test("strips ports from `hostname:port` entries", () => {
    expect([...parseAllowedHostsEnv("host.docker.internal:5899")]).toEqual([
      "host.docker.internal",
    ]);
  });

  test("extracts hostname from full URL entries", () => {
    expect([
      ...parseAllowedHostsEnv("http://host.docker.internal:5899/"),
    ]).toEqual(["host.docker.internal"]);
    expect([...parseAllowedHostsEnv("https://Foo.Local")]).toEqual([
      "foo.local",
    ]);
  });

  test("drops URL-shaped entries that don't parse", () => {
    // Unbalanced brackets — `new URL` rejects, entry is skipped.
    expect([...parseAllowedHostsEnv("http://[::1")]).toEqual([]);
  });

  test("URL-shaped entries that parse keep their hostname", () => {
    // Comma-split happens first, so this becomes two entries:
    //   "http://bad"  -> new URL("http://bad") succeeds with hostname "bad"
    //   "host.docker.internal" -> bare hostname, kept as-is
    expect(
      [...parseAllowedHostsEnv("http://bad,host.docker.internal")].sort(),
    ).toEqual(["bad", "host.docker.internal"]);
  });

  test("handles mixed comma-separated entries", () => {
    const set = parseAllowedHostsEnv(
      "foo.local,host.docker.internal:5899,http://bar.local/,BAZ.LOCAL",
    );
    expect([...set].sort()).toEqual([
      "bar.local",
      "baz.local",
      "foo.local",
      "host.docker.internal",
    ]);
  });

  test("stores entries lowercased; callers lowercase before set.has()", () => {
    const set = parseAllowedHostsEnv("Host.Docker.Internal:5899");
    expect(set.has("host.docker.internal")).toBe(true);
    // Set itself is case-sensitive on lookup; the production caller in
    // server.ts normalizes via `.toLowerCase()` before `set.has(...)`.
    expect(set.has("HOST.DOCKER.INTERNAL")).toBe(false);
  });
});

describe("hostnameOnly", () => {
  test("returns bare IPv4 hostnames unchanged", () => {
    expect(hostnameOnly("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOnly("192.168.65.2")).toBe("192.168.65.2");
  });

  test("strips ports from IPv4 host:port", () => {
    expect(hostnameOnly("127.0.0.1:5899")).toBe("127.0.0.1");
    expect(hostnameOnly("foo.local:8080")).toBe("foo.local");
  });

  test("strips brackets from bracketed IPv6 host:port", () => {
    expect(hostnameOnly("[::1]:5899")).toBe("::1");
    expect(hostnameOnly("[fe80::1]:5899")).toBe("fe80::1");
  });

  test("does not split a bare (unbracketed) IPv6 address on colons", () => {
    expect(hostnameOnly("::1")).toBe("::1");
    expect(hostnameOnly("fe80::1")).toBe("fe80::1");
    expect(hostnameOnly("fc00:1234:5678::1")).toBe("fc00:1234:5678::1");
  });
});
