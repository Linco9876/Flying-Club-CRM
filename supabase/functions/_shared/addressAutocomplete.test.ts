import { assertEquals } from "jsr:@std/assert@1";
import { photonAddress, photonLocality } from "./addressAutocomplete.ts";

Deno.test("Photon address uses the Australian suburb or district before the regional city", () => {
  const properties = {
    housenumber: "23",
    street: "Lawrence Road",
    district: "Strathfieldsaye",
    city: "Bendigo",
    state: "Victoria",
    postcode: "3551",
    country: "Australia",
  };

  assertEquals(photonLocality(properties), "Strathfieldsaye");
  assertEquals(
    photonAddress(properties),
    "23 Lawrence Road, Strathfieldsaye, Victoria 3551, Australia",
  );
});

Deno.test("Photon address uses a city when no more specific locality is supplied", () => {
  assertEquals(
    photonAddress({
      housenumber: "1",
      street: "Example Street",
      city: "Bendigo",
      state: "Victoria",
      postcode: "3550",
      country: "Australia",
    }),
    "1 Example Street, Bendigo, Victoria 3550, Australia",
  );
});

Deno.test("Photon locality prioritises an explicit suburb over other administrative labels", () => {
  assertEquals(
    photonLocality({
      suburb: "East Bendigo",
      district: "Bendigo",
      city: "Bendigo",
    }),
    "East Bendigo",
  );
});
