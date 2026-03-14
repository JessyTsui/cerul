import { describe, expect, it } from "vitest";
import {
  HOME_SOCIAL_IMAGE_VERSION,
  SOCIAL_IMAGE_VERSION,
  defaultOpenGraphImages,
  defaultTwitterImages,
  homeOpenGraphImages,
  homeTwitterImages,
} from "./social-metadata";

describe("social metadata", () => {
  it("adds a versioned Open Graph image URL", () => {
    expect(defaultOpenGraphImages[0]).toMatchObject({
      url: `/og-image.png?v=${SOCIAL_IMAGE_VERSION}`,
      width: 1200,
      height: 630,
    });
  });

  it("adds a versioned Twitter image URL", () => {
    expect(defaultTwitterImages[0]).toMatchObject({
      url: `/og-twitter.png?v=${SOCIAL_IMAGE_VERSION}`,
      width: 800,
      height: 418,
    });
  });

  it("gives the homepage its own Open Graph image version", () => {
    expect(homeOpenGraphImages[0]).toMatchObject({
      url: `/og-image.png?v=${HOME_SOCIAL_IMAGE_VERSION}`,
      width: 1200,
      height: 630,
    });
  });

  it("gives the homepage its own Twitter image version", () => {
    expect(homeTwitterImages[0]).toMatchObject({
      url: `/og-twitter.png?v=${HOME_SOCIAL_IMAGE_VERSION}`,
      width: 800,
      height: 418,
    });
  });
});
