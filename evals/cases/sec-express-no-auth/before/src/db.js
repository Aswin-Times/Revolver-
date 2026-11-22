const users = new Map();

module.exports = {
  users: {
    delete: async (id) => users.delete(id),
  },
};
