// Local synthetic evaluation only. Never deploy this unauthenticated harness.
import {
  buildDeficiencyRequest,
  validateDeficiencySuggestions,
  MODEL,
} from "../../functions/api/deficiency-suggestions.js";

export default {
  async fetch(request, env) {
    const { comments, openDeficiencies } = await request.json();
    const raw = await env.AI.run(
      MODEL,
      buildDeficiencyRequest(comments, openDeficiencies),
    );
    try {
      return Response.json({
        ...validateDeficiencySuggestions(
          raw.response,
          comments,
          openDeficiencies,
        ),
      });
    } catch {
      return Response.json(
        { error: "Invalid model response" },
        { status: 502 },
      );
    }
  },
};
