// User-submitted custom recipes awaiting admin review. Promote folds an
// admin's edits into a guest build and graduates it into the drink catalog.
import { readJsonBody, jsonRoute } from "../http-util.js";
import * as submissionsStore from "../submissions-store.js";
import * as drinksStore from "../drinks-store.js";

export async function submissionRoutes(req, res, urlPath) {
  if (urlPath === "/api/submissions" && req.method === "GET") {
    await jsonRoute(res, () => submissionsStore.load());
    return true;
  }
  if (urlPath === "/api/submissions" && req.method === "POST") {
    await jsonRoute(res, async () => submissionsStore.create(await readJsonBody(req)), {
      status: 201,
    });
    return true;
  }
  const submissionMatch = urlPath.match(/^\/api\/submissions\/([^/]+)$/);
  if (submissionMatch && req.method === "DELETE") {
    await jsonRoute(res, () => submissionsStore.remove(submissionMatch[1]));
    return true;
  }
  const submissionPromoteMatch = urlPath.match(/^\/api\/submissions\/([^/]+)\/promote$/);
  if (submissionPromoteMatch && req.method === "POST") {
    await jsonRoute(
      res,
      async () => {
        const body = await readJsonBody(req);
        const submission = await submissionsStore.get(submissionPromoteMatch[1]);
        if (!submission) throw new Error("not found");
        // Promotion folds the admin's edits (category, glass, color, etc.) into
        // the guest-supplied name + ingredients, then drops the submission.
        // drinksStore.create runs the full validator so a malformed promote
        // payload bounces with 400 before we delete the original.
        const drink = await drinksStore.create({
          ...body,
          name: body.name || submission.name,
          ingredients: body.ingredients?.length ? body.ingredients : submission.ingredients,
        });
        await submissionsStore.remove(submission.id);
        return drink;
      },
      { status: 201 }
    );
    return true;
  }

  return false;
}
