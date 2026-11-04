export class AuthController {
  #auth;

  constructor(auth) {
    this.#auth = auth;
  }

  login = async (req, res) => {
    const { email, password } = req.body;
    res.json(await this.#auth.login(email, password));
  };

  me = (req, res) => {
    res.json({ email: req.principal });
  };
}
