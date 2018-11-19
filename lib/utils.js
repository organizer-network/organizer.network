module.exports = {

	error_page: (rsp, type) => {
		rsp.render('page', {
			title: 'Error',
			view: 'error',
			content: {
				type: type
			}
		});
	}

};
