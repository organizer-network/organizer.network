(function() {

	function form_handler(query, callback) {
		$(query).submit(function(e) {
			e.preventDefault();

			if ($(query).hasClass('loading')) {
				return;
			}

			var data = $(query).serialize();
			var url = $(query).attr('action');

			$(query).find('.response').html('Please wait...');
			$(query).addClass('loading');

			$.post(url, data, function(rsp) {
				$(query).removeClass('loading');
				if (rsp.ok) {
					$(query).find('.response').html('');
					if (typeof callback == 'function') {
						callback(rsp, e.target);
					}
				} else {
					$(query).find('.response').html(rsp.error);
				}
			})
			.fail(function(rsp) {
				var error = 'Error connecting to server.';
				if ('responseJSON' in rsp && 'error' in rsp.responseJSON) {
					error = rsp.responseJSON.error;
				}
				$(query).find('.response').html(error);
				$(query).removeClass('loading');
			});
		});
	}

	function format_timestamp(el) {
		var iso_date = $(el).html().trim();
		var nice_timestamp = moment(iso_date).format('MMM D, YYYY, h:mma');
		$(el).attr('data-orig', iso_date);
		$(el).html(nice_timestamp);
	}

	function setup_replies(query) {
		$(query).click(function(e) {
			var id = parseInt($(e.target).data('id'));
			if (id) {
				e.preventDefault();
				$link = $(e.target);
				$link.toggleClass('selected');
				if ($link.hasClass('selected')) {

					$('#reply-' + id).html('<div class="replies"><div class="response">Loading replies...</div></div>');

					$.get('/api/replies/' + id, function(rsp) {
						$('#reply-' + id).html(rsp);
						$('#reply-' + id).find('.timestamp a').each(function(index, el) {
							format_timestamp(el);
						});
						form_handler($('#reply-' + id).find('form'), function(rsp, el) {
							$(el).find('textarea[name="content"]').val('');
							$.get('/api/message/' + rsp.message.id, function(rsp) {

								var $replies = $(el).closest('.replies');
								var $message = $(el).closest('.message');

								$replies.find('.message-list').append(rsp);
								var $timestamp = $replies.find('.message-list .message:last-child .timestamp a');
								format_timestamp($timestamp);
								$('#members li:eq(0)').before($('#members li.curr-person'));
								$(el).find('.response').html('');

								var count = $replies.find('.message-list .message').length;
								var label = (count == 1) ? ' reply' : ' replies';
								$message.find('.reply a').html(count + label);

							});
						});
					});
				} else {
					$('#reply-' + id).html('');
				}
			}
		});
	}

	$(document).ready(function() {

		form_handler('#login', function(rsp) {
			$('#login .response').html('✅ Email sent, please check your inbox.');
			$('#login .controls').addClass('hidden');
		});

		form_handler('#send', function(rsp) {
			$('#send .response').html('Your message has been sent.');
			$('#send textarea[name="content"]').val('');
			$.get('/api/message/' + rsp.message.id, function(rsp) {
				$('#message-list').prepend(rsp);
				format_timestamp($('#message-list .message:first-child .timestamp a'));
				$('#members li:eq(0)').before($('#members li.curr-person'));
				setup_replies('#message-list .message:first-child .reply a');
			});
		});

		var first_update = ($('input[name="name"]').val() == '');
		form_handler('#profile form', function(rsp) {
			if (first_update) {
				window.location = '/group/commons';
			} else {
				window.location = '/' + rsp.person.slug;
			}
		});

		$("#send #content").keyup(function(e) {
			while($(this).outerHeight() < this.scrollHeight + parseFloat($(this).css("borderTopWidth")) + parseFloat($(this).css("borderBottomWidth"))) {
				$(this).height($(this).height() + 1);
			};
		});

		if ($('#context').length > 0) {
			$('#intro').addClass('above');
			$('html, body').animate({
				scrollTop: $("#context").offset().top - 32
			}, 500);
		}

		$('.timestamp a').each(function(index, el) {
			format_timestamp(el);
		});

		$('#invite-input').focus(function() {
			this.select();
			try {
				if (document.execCommand('copy')) {
					$('#invite-response').html('Copied to your clipboard.');
				}
			} catch(err) {
			}
		});

		$('#join-link').click(function(e) {
			if (! $(document.body).hasClass('logged-in')) {
				e.preventDefault();
				$('html, body').animate({
					scrollTop: 0
				}, 500);
			}
		});

		setup_replies('.reply a');

	});

})();
