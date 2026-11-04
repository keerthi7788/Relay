import jwt from "jsonwebtoken";
import { UnauthorizedError } from "../shared/errors.js";
import { hashPassword, verifyPassword } from "../shared/passwords.js";

const ALGORITHM = "HS256";
const normalize = (email) => email.trim().toLowerCase();

export class AuthService {
  #uow;
  #secret;
  #expiresIn;
  #decoyHash;

  constructor(uow, { secret, expiresIn }) {
    this.#uow = uow;
    this.#secret = secret;
    this.#expiresIn = expiresIn;
  }

  async ensureUser(email, password) {
    await this.#uow.repos.users.save(normalize(email), await hashPassword(password));
  }

  async login(email, password) {
    const address = normalize(email);
    const user = await this.#uow.repos.users.find(address);
    // An unknown email takes as long as a wrong password, so timing doesn't reveal who has an account.
    this.#decoyHash ??= await hashPassword("decoy");
    const matches = await verifyPassword(password, user?.passwordHash ?? this.#decoyHash);
    if (!user || !matches) {
      throw new UnauthorizedError("invalid_credentials", "Email or password is wrong");
    }
    const token = jwt.sign({ sub: address }, this.#secret, {
      algorithm: ALGORITHM,
      expiresIn: this.#expiresIn,
    });
    return { token, email: address };
  }

  verify(token) {
    try {
      return jwt.verify(token, this.#secret, { algorithms: [ALGORITHM] }).sub;
    } catch {
      return null;
    }
  }
}
